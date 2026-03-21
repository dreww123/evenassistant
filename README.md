


# evenassistant
An API driven interface for the Even Realities G2 glasses, using ring inputs. 

This repository is set up for use with cloudflared as well as an API via openAI. 
If you want to use a different LLM, then you'll need to reconfigure the code. 
The API is protected. 

Built on visual studio code

###Install these packages:
npm install openai express cors multer dotenv
npm install vite
npm install @evenrealities/even_hub_sdk
npm install -g @evenrealities/evenhub-cli

###Next step:
In .env add your API key. 

###Next Step:
run this: npx vite build
Then run this: node server.js

#Next step:
Setup a cloudflare tunnel to this folder

#Next step:
run this: npx @evenrealities/evenhub-cli qr --url "your-cloudflare-url here"

###Next:
Scan code QR code w/ even app and enjoy. 

###Notice
The server.js file is coded to work with an OpenAI API. If you want to use Grok or Claude, etc. You'll need to make changes to that. 



###Change Log V1.1
-I removed read/write for audio and switched to in-memory audio
-There is now a "home screen" that shows your three prior conversations
-Adjusted container parameters to stop text from getting cut off
