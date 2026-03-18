# evenassistant
An API driven interface for the Even Realities G2 glasses, using ring inputs. 

This repository is set up for use with cloudflared as well as an API via openAI. 
If you want to use a different LLM, then you'll need to reconfigure the code. 
The API is protected. 

In .env add your API key. 

This was built on visual studio code 

Install ER even_hub_sdk
Install evenhub-cli
install evenhub-simulator

Then run npm install vite

Then run npx vite

Then run npm install dotenv

Then npm vite build

then you'll want to start server via
  node server.js 

Make a cloudflare tunnel for http://localhost:3001/ 

generate QR code w/ npx @evenrealities/evenhub-cli qr --url *your cloudflare URL Here*
