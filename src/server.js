// src/server.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import crypto from 'crypto';
import { getAgent, AGENT_DID_ALIAS } from './agent.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3002;

const messageQueue = new Map();

app.use(cors({ origin: '*' })); // As per your original file
app.use(express.text({ type: 'application/didcomm-encrypted+json', limit: '5mb' }));
app.use(express.json()); 

let agentInstance; 

async function startServer() {
    try {
        agentInstance = await getAgent(); 
        console.log('[Server] Cloud Agent Initialized.');

        app.get('/', (req, res) => {
            res.send('ClinConNet Cloud Agent is running!');
        });
        
        app.post('/didcomm', async (req, res) => {
            console.log('[Server] Received POST on /didcomm');
            const currentAgent = await getAgent(); 
        
            try {
                const unpackedResult = await currentAgent.unpackDIDCommMessage({ message: req.body });
                const receivedMessage = unpackedResult.message; 
                console.log('[Server] Message unpacked. Type:', receivedMessage.type);
        
                if (receivedMessage.type === 'https://didcomm.org/coordinate-mediation/2.0/mediate-request') {
                    const { from: requesterDid, to: mediatorDid, id: thid } = receivedMessage;
                    await currentAgent.mediationManagerSaveMediation({ requesterDid, status: 'GRANTED' });
                    await currentAgent.mediationManagerAddRecipientDid({ requesterDid, recipientDid: requesterDid });
                    console.log(`[Server] Mediation GRANTED for ${requesterDid}`);
        
                    const mediateGrantMessage = {
                        type: 'https://didcomm.org/coordinate-mediation/2.0/mediate-grant',
                        from: mediatorDid, to: requesterDid, id: crypto.randomUUID(), thid,
                        body: { routing_did: [mediatorDid] }
                    };
        
                    const packedResponse = await currentAgent.packDIDCommMessage({ message: mediateGrantMessage, packing: 'authcrypt', to: requesterDid, from: mediatorDid });
                    return res.status(200).contentType('application/didcomm-encrypted+json').send(packedResponse.message); 
        
                } else if (receivedMessage.type === 'https://didcomm.org/routing/2.0/forward') {
                    // --- THIS IS THE CORRECTED LOGIC ---
                    console.log('[Server] Processing forward message...');
                    const senderDid = receivedMessage.from; // The SPA's DID
                    const recipientDid = receivedMessage.body?.next; // The Extension's DID
                    const packedMessageToForward = receivedMessage.attachments?.[0]?.data?.json;

                    if (!recipientDid || !packedMessageToForward) {
                        throw new Error('Invalid forward message: missing `next` recipient or message attachment.');
                    }

                    // The incorrect check for sender mediation has been removed.
                    // We simply accept the message and queue it for the intended recipient.
                    
                    let queue = messageQueue.get(recipientDid);
                    if (!queue) {
                        queue = [];
                        messageQueue.set(recipientDid, queue);
                    }
                    queue.push(packedMessageToForward);
                    console.log(`[Server] Stored message from ${senderDid} for recipient ${recipientDid}. Queue size: ${queue.length}`);
                    return res.status(202).send('Forward message accepted for delivery.');
                    // --- END OF CORRECTION ---

                } else {
                    console.warn(`[Server] Received unhandled DIDComm message type: '${receivedMessage.type}'.`);
                    return res.status(202).send(`Message received but not processed.`);
                }
        
            } catch (error) {
                console.error('[Server] Error in /didcomm handler:', error.message);
                return res.status(500).json({ error: error.message });
            }
        });

        app.post('/pickup', async (req, res) => {
            console.log(`[Server] Pickup requested for recipient: ${req.body.recipient_did}`);
            const { recipient_did } = req.body;
            if (!recipient_did) return res.status(400).json({ error: '`recipient_did` is required.' });

            const queue = messageQueue.get(recipient_did) || [];
            const messagesToDeliver = queue.splice(0, 10);
            console.log(`[Server] Delivering ${messagesToDeliver.length} messages. Remaining in queue: ${queue.length}`);
            
            const mediatorDid = (await agentInstance.didManagerGetByAlias({ alias: AGENT_DID_ALIAS })).did;
            const deliveryMessage = {
                type: 'https://didcomm.org/messagepickup/3.0/delivery',
                from: mediatorDid,
                to: recipient_did,
                id: crypto.randomUUID(),
                attachments: messagesToDeliver.map((msg, i) => ({
                    id: `${i}`,
                    media_type: 'application/json',
                    data: { json: msg }
                }))
            };
            return res.status(200).json(deliveryMessage);
        });

        app.listen(port, async () => {
            console.log(`[Server] ClinConNet Cloud Agent listening on port ${port}`);
            const id = await agentInstance.didManagerGetByAlias({ alias: AGENT_DID_ALIAS });
            console.log(`[Server] Agent is using DID: "${id.did}"`);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();