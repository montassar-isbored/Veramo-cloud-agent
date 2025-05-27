// src/server.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { getAgent, AGENT_DID_ALIAS } from './agent.js'; // Assuming ESM syntax (add "type": "module" to package.json)

dotenv.config();

const app = express();
const port = process.env.PORT || 3002; // Use PORT from .env or default to 3002

// Configure CORS
const corsOptions = {
    origin: 'http://localhost:5173', // Allow requests from organization SPA running vite on port 5173
    methods: ['POST', 'GET', 'OPTIONS'], // Allow these methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allow these headers
  };
  app.use(cors(corsOptions));

// Middleware to parse raw request body for DIDComm messages
// DIDComm messages might be plain JSON or JWEs (which are strings)
app.use(express.text({ type: 'application/didcomm-encrypted+json', limit: '5mb' }));

// If you need to parse other JSON bodies for other routes:
app.use(express.json({ type: 'application/json' })); 

let agent; // Hold the initialized agent

// Main async function to start the server
async function startServer() {
    try {
        console.log('[Server] Initializing Cloud Agent...');
        agent = await getAgent(); // Initialize agent from agent.js
        console.log('[Server] Cloud Agent Initialized.');

        // --- DIDComm Endpoint ---
        app.post('/didcomm', async (req, res) => {
            console.log('[Server] Received POST on /didcomm');
            console.log('[Server] Request body:', req.body);
            try {
                if (!agent) {
                    throw new Error("Agent not initialized yet.");
                }
                const message = await agent.handleMessage(req.body);
                console.log("[Server] Message handled by agent. Response message:", message);

                // DIDComm handling might result in a message to be sent back
                // or just processing internally. handleMessage often doesn't return
                // something directly usable as an HTTP response.
                // For now, just send 200 OK if handleMessage doesn't throw.
                // Real implementation needs more logic based on message types.
                res.status(200).send('Message received.');

            } catch (error) {
                console.error('[Server] Error handling DIDComm message:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // --- Basic Root Endpoint (Optional) ---
        app.get('/', (req, res) => {
            res.send('ClinConNet Cloud Agent is running!');
        });

        // --- Start Listening ---
        app.listen(port, () => {
            console.log(`[Server] ClinConNet Cloud Agent listening on port ${port}`);
            // Log the agent's specific DID using the alias

        // src/server.js (inside app.listen callback)
            agent?.didManagerFind({ alias: AGENT_DID_ALIAS, provider: 'did:key' }) // Ensure provider is here too
            .then(id => console.log(`[Server] Agent successfully initialized with DID: `, JSON.stringify(id[0].did))) // A bit complex but works
            .catch(e => console.warn(`[Server] Could not get agent DID by alias '${AGENT_DID_ALIAS}' on startup: ${e.message}`));
                 
        });

    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

startServer(); // Run the server startup function