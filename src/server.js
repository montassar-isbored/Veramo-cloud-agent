// src/server.js
import express from 'express';
import dotenv from 'dotenv';
import { getAgent, AGENT_DID_ALIAS } from './agent.js'; // Assuming ESM syntax (add "type": "module" to package.json)

dotenv.config();

const app = express();
const port = process.env.PORT || 3000; // Use PORT from .env or default to 3000

// Middleware to parse raw request body for DIDComm messages
// DIDComm messages might be plain JSON or JWEs (which are strings)
app.use(express.raw({ type: '*/*', limit: '5mb' })); // Accept raw body for all types

let agent; // Hold the initialized agent

// Main async function to start the server
async function startServer() {
    try {
        console.log('[Server] Initializing Veramo Agent...');
        agent = await getAgent(); // Initialize agent from agent.js
        console.log('[Server] Veramo Agent Initialized.');

        // --- DIDComm Endpoint ---
        app.post('/didcomm', async (req, res) => {
            console.log('[Server] Received POST on /didcomm');
            try {
                if (!agent) {
                    throw new Error("Agent not initialized yet.");
                }
                // We expect the raw message body (Buffer)
                const message = await agent.handleMessage({ raw: req.body });
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
            agent?.didManagerGet({ alias: AGENT_DID_ALIAS, provider: 'did:key' }) // Use defined alias constant
                 .then(id => console.log(`[Server] Agent successfully initialized with DID: ${id?.did}`))
                 .catch(e => console.warn(`[Server] Could not get agent DID by alias '${AGENT_DID_ALIAS}' on startup: ${e.message}`));
        });

    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

startServer(); // Run the server startup function