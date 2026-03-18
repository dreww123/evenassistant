document.body.innerHTML = `
  <h1>Even Assistant</h1>
  <p id="status">Starting...</p>
  <pre id="details"></pre>
`;

async function init() {
  const status = document.getElementById("status");
  const details = document.getElementById("details");

  try {
    const sdk = await import("@evenrealities/even_hub_sdk");
    const bridge = await sdk.waitForEvenAppBridge();

    let isListening = false;
    let audioChunks = [];
    let totalBytes = 0;
    let firstChunkSamples = [];
    let statsInterval = null;

    // UI state
    let screenMode = "welcome"; // welcome | answer | confirmExit
    let exitSelection = 0; // 0 = yes, 1 = no

    // Scroll state for answer screen
    let fullResponseText = "";
    let wrappedLines = [];
    let scrollOffset = 0;

    // Tuned display settings
    const MAX_CHARS_PER_LINE = 48;
    const VISIBLE_LINES = 9;
    const SCROLL_STEP = 3;

    // Empty-input thresholds
    const MIN_AUDIO_CHUNKS = 3;
    const MIN_AUDIO_BYTES = 2000;

    const WELCOME_TEXT = "Greetings sire!\nAsk me anything your heart desires.";

    async function updateGlassesText(text) {
      await bridge.textContainerUpgrade({
        containerID: 1,
        containerName: "mainText",
        contentOffset: 0,
        contentLength: text.length,
        content: text
      });
    }

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function hasMeaningfulAudio() {
      return audioChunks.length >= MIN_AUDIO_CHUNKS && totalBytes >= MIN_AUDIO_BYTES;
    }

    function wrapTextToLines(text, maxCharsPerLine = 40) {
      const normalized = (text || "")
        .replace(/\r/g, "")
        .replace(/\t/g, " ")
        .replace(/[ ]+/g, " ")
        .trim();

      if (!normalized) return [""];

      const paragraphs = normalized.split("\n").map(p => p.trim());
      const lines = [];

      for (const paragraph of paragraphs) {
        if (!paragraph) {
          lines.push("");
          continue;
        }

        const words = paragraph.split(" ");
        let currentLine = "";

        for (const word of words) {
          if (!currentLine) {
            currentLine = word;
            continue;
          }

          const candidate = `${currentLine} ${word}`;

          if (candidate.length <= maxCharsPerLine) {
            currentLine = candidate;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }

        if (currentLine) {
          lines.push(currentLine);
        }
      }

      return lines.length ? lines : [""];
    }

    function maxScrollOffset() {
      return Math.max(0, wrappedLines.length - VISIBLE_LINES);
    }

    function buildVisibleAnswerText() {
      const canScrollUp = scrollOffset > 0;
      const canScrollDown = scrollOffset < maxScrollOffset();

      let visibleLineCount = VISIBLE_LINES;
      if (canScrollUp) visibleLineCount -= 1;
      if (canScrollDown) visibleLineCount -= 1;

      const visible = wrappedLines.slice(
        scrollOffset,
        scrollOffset + Math.max(1, visibleLineCount)
      );

      const output = [];

      if (canScrollUp) output.push("↑");
      output.push(...visible);
      if (canScrollDown) output.push("↓");

      return output.join("\n");
    }

    async function renderWelcomeScreen() {
      screenMode = "welcome";
      isListening = false;
      await updateGlassesText(WELCOME_TEXT);
    }

    async function renderConfirmExitScreen() {
      screenMode = "confirmExit";
      const yesPrefix = exitSelection === 0 ? "> " : "  ";
      const noPrefix = exitSelection === 1 ? "> " : "  ";

      const text =
        "Do you want to exit?\n\n" +
        `${yesPrefix}Yes\n` +
        `${noPrefix}No`;

      await updateGlassesText(text);
    }

    async function renderAnswerScreen() {
      screenMode = "answer";
      const text = buildVisibleAnswerText();
      await updateGlassesText(text);
    }

    async function setAnswerResponse(text) {
      fullResponseText = text || "";
      wrappedLines = wrapTextToLines(fullResponseText, MAX_CHARS_PER_LINE);
      scrollOffset = 0;
      await renderAnswerScreen();
    }

    function startStatsDisplay() {
      stopStatsDisplay();
      statsInterval = setInterval(() => {
        details.textContent =
          `Listening...\n` +
          `Chunks: ${audioChunks.length}\n` +
          `Total bytes: ${totalBytes}\n\n` +
          `First chunk samples:\n` +
          JSON.stringify(firstChunkSamples, null, 2);
      }, 500);
    }

    function stopStatsDisplay() {
      if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }
    }

    async function uploadAudio() {
      const flatBytes = audioChunks.flatMap(chunk => Array.from(chunk));
      const uint8 = new Uint8Array(flatBytes);

      const blob = new Blob([uint8], { type: "application/octet-stream" });
      const formData = new FormData();
      formData.append("audio", blob, "recording.raw");

      status.textContent = `Uploading ${uint8.length} bytes...`;
      details.textContent =
        `Stopped.\n` +
        `Chunks: ${audioChunks.length}\n` +
        `Total bytes: ${uint8.length}\n` +
        `Sending to backend...`;

      await setAnswerResponse("Processing...");

      try {
        const response = await fetch("/audio", {
          method: "POST",
          body: formData
        });

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || "Backend returned failure");
        }

        if (result.emptyInput) {
          status.textContent = "Empty input ignored";
          details.textContent = "No speech detected. Returned to welcome screen.";
          await renderWelcomeScreen();
          return;
        }

        status.textContent = "AI response received";
        details.textContent =
          `Transcript:\n${result.transcript}\n\n` +
          `Answer:\n${result.answer}`;

        await setAnswerResponse(result.answer);
      } catch (err) {
        console.error("Upload failed:", err);
        status.textContent = "Upload failed";
        details.textContent += `\nUpload error:\n${err?.message || String(err)}`;
        await setAnswerResponse("Upload failed");
      }
    }

    await bridge.createStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        {
          xPosition: 30,
          yPosition: 50,
          width: 700,
          height: 290,
          borderWidth: 0,
          borderColor: 0,
          borderRdaius: 0,
          paddingLength: 0,
          containerID: 1,
          containerName: "mainText",
          isEventCapture: 1,
          content: "Idle"
        }
      ],
      listObject: [],
      imageObject: []
    });

    status.textContent = "Ready.";
    await renderWelcomeScreen();

    bridge.onEvenHubEvent(async (event) => {
      const sysType = event?.sysEvent?.eventType;
      const textType = event?.textEvent?.eventType;
      const audioPcm = event?.audioEvent?.audioPcm;

      const isSingleTap =
        event?.sysEvent &&
        (sysType === undefined || sysType === null) &&
        !event?.textEvent &&
        !event?.audioEvent;

      if (audioPcm && isListening) {
        audioChunks.push(audioPcm);
        totalBytes += audioPcm.length || 0;

        if (firstChunkSamples.length < 5) {
          firstChunkSamples.push({
            type: typeof audioPcm,
            isArray: Array.isArray(audioPcm),
            length: audioPcm.length,
            sample: Array.from(audioPcm).slice(0, 20)
          });
        }

        return;
      }

      // SINGLE TAP
      if (isSingleTap) {
        // Exit confirmation mode
        if (screenMode === "confirmExit") {
          if (exitSelection === 0) {
            stopStatsDisplay();
            status.textContent = "Exiting app";
            await bridge.shutDownPageContainer({ exitMode: 0 });
          } else {
            status.textContent = "Exit cancelled";
            await renderWelcomeScreen();
          }
          return;
        }

        // Ignore taps on answer screen unless we're listening
        if (screenMode === "answer" && !isListening) {
          return;
        }

        // Welcome screen: tap starts listening
        // Listening state: tap stops listening
        isListening = !isListening;

        if (isListening) {
          audioChunks = [];
          totalBytes = 0;
          firstChunkSamples = [];

          const audioResult = await bridge.audioControl(true);
          screenMode = "welcome";
          await updateGlassesText("Listening...");
          status.textContent = "Listening";
          details.textContent = `audioControl(true): ${JSON.stringify(audioResult)}`;
          startStatsDisplay();
        } else {
          const audioResult = await bridge.audioControl(false);
          stopStatsDisplay();

          status.textContent = `Stopped. Waiting for final chunks...`;
          details.textContent =
            `audioControl(false): ${JSON.stringify(audioResult)}\n` +
            `Chunks so far: ${audioChunks.length}\n` +
            `Total bytes so far: ${totalBytes}`;

          await sleep(700);

          if (!hasMeaningfulAudio()) {
            status.textContent = "Ignored empty input";
            details.textContent =
              `Recording too short or empty.\n` +
              `Chunks: ${audioChunks.length}\n` +
              `Total bytes: ${totalBytes}`;
            await renderWelcomeScreen();
            return;
          }

          await uploadAudio();
        }

        return;
      }

      // SWIPE UP
      if (textType === 1) {
        if (screenMode === "confirmExit") {
          exitSelection = Math.max(0, exitSelection - 1);
          await renderConfirmExitScreen();
          return;
        }

        if (screenMode === "answer") {
          if (scrollOffset > 0) {
            scrollOffset = Math.max(0, scrollOffset - SCROLL_STEP);
            await renderAnswerScreen();
            status.textContent = `Scroll ${scrollOffset + 1}/${maxScrollOffset() + 1}`;
          }
          return;
        }

        return;
      }

      // SWIPE DOWN
      if (textType === 2) {
        if (screenMode === "confirmExit") {
          exitSelection = Math.min(1, exitSelection + 1);
          await renderConfirmExitScreen();
          return;
        }

        if (screenMode === "answer") {
          if (scrollOffset < maxScrollOffset()) {
            scrollOffset = Math.min(maxScrollOffset(), scrollOffset + SCROLL_STEP);
            await renderAnswerScreen();
            status.textContent = `Scroll ${scrollOffset + 1}/${maxScrollOffset() + 1}`;
          }
          return;
        }

        return;
      }

      // DOUBLE TAP
      if (sysType === 3) {
        stopStatsDisplay();

        if (isListening) {
          isListening = false;
          await bridge.audioControl(false);
        }

        if (screenMode === "answer") {
          status.textContent = "Returning to welcome screen";
          await renderWelcomeScreen();
          return;
        }

        if (screenMode === "welcome") {
          exitSelection = 1; // default to "No"
          status.textContent = "Exit confirmation";
          await renderConfirmExitScreen();
          return;
        }

        if (screenMode === "confirmExit") {
          await renderWelcomeScreen();
          return;
        }
      }
    });

  } catch (err) {
    console.error("Error:", err);
    status.textContent = "Failed.";
    details.textContent = err?.stack || err?.message || String(err);
  }
}

init();
