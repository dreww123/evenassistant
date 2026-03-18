require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const wav = require("wav");
const OpenAI = require("openai");

const app = express();
const upload = multer();
const PORT = process.env.PORT || 3001;

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const UPLOAD_DIR = path.join(__dirname, "uploads");
const DIST_DIR = path.join(__dirname, "dist");

console.log("Running from:", __dirname);
console.log("Uploads folder will be:", UPLOAD_DIR);
console.log("Dist folder will be:", DIST_DIR);

app.use(cors());
app.use(express.json());

app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(DIST_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

app.post("/audio", upload.single("audio"), async (req, res) => {
  try {
    console.log("\n--- Received audio upload ---");

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No audio file received"
      });
    }

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    const timestamp = Date.now();

    const rawFilename = `recording-${timestamp}.raw`;
    const rawPath = path.join(UPLOAD_DIR, rawFilename);
    fs.writeFileSync(rawPath, req.file.buffer);

    const wavFilename = `recording-${timestamp}.wav`;
    const wavPath = path.join(UPLOAD_DIR, wavFilename);

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    await new Promise((resolve, reject) => {
      let writer;

      try {
        writer = new wav.FileWriter(wavPath, {
          channels: 1,
          sampleRate: 16000,
          bitDepth: 16
        });
      } catch (err) {
        console.error("Failed to create WAV writer:", err);
        return reject(err);
      }

      writer.on("finish", resolve);
      writer.on("error", (err) => {
        console.error("WAV writer error:", err);
        reject(err);
      });

      writer.write(req.file.buffer);
      writer.end();
    });

    console.log("Saved RAW:", rawPath);
    console.log("Saved WAV:", wavPath);

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(wavPath),
      model: "gpt-4o-mini-transcribe"
    });

    const transcript = (transcription.text || "").trim();
    console.log("Transcript:", transcript);

    if (!transcript) {
      return res.json({
        success: true,
        emptyInput: true,
        transcript: "",
        answer: "",
        rawFile: rawFilename,
        wavFile: wavFilename
      });
    }

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are an assistant for AR glasses. " +
                "Keep answers concise, readable, and optimized for a tiny HUD. " +
                "Use short sentences or short bullet points. " +
                "Avoid long introductions, disclaimers, and fluff. " +
                "Prefer 3-6 compact lines total unless the user clearly asks for more detail."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: transcript
            }
          ]
        }
      ]
    });

    const answer = (response.output_text || "No response text returned.").trim();
    console.log("Answer:", answer);

    res.json({
      success: true,
      transcript,
      answer,
      rawFile: rawFilename,
      wavFile: wavFilename
    });
  } catch (err) {
    console.error("Server error while handling /audio:", err);
    res.status(500).json({
      success: false,
      error: err.message || String(err)
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  console.log(`Open on this computer: http://localhost:${PORT}`);
});
