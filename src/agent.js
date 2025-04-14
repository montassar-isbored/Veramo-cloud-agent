// src/agent.js
// CORRECTED VERSION - Plain JavaScript for Node.js

import { createAgent } from '@veramo/core';
// Removed unused Interface imports from @veramo/core-types
import { KeyManager } from '@veramo/key-manager';
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local';
import { DIDManager } from '@veramo/did-manager';
import { KeyStore, DIDStore, PrivateKeyStore, migrations, Entities } from '@veramo/data-store';
import { KeyDIDProvider } from '@veramo/did-provider-key';
import { WebDIDProvider } from '@veramo/did-provider-web';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { Resolver } from 'did-resolver';
import { getResolver as getWebResolver } from 'web-did-resolver';
import { MessageHandler } from '@veramo/message-handler';
import { DIDComm, DIDCommMessageHandler } from '@veramo/did-comm';

import { DataSource } from 'typeorm';
import 'reflect-metadata'; // Required for TypeORM
import dotenv from 'dotenv';

dotenv.config(); // Load .env file variables

// --- Agent Setup ---
let agent = null;
let initializationPromise = null;

const DB_FILENAME = './database.sqlite';
const KMS_SECRET_KEY = process.env.KMS_SECRET_KEY;
const AGENT_DID_ALIAS = 'cloud-agent-default-key';
const DIDCOMM_SERVICE_ENDPOINT = `http://localhost:${process.env.PORT || 3000}/didcomm`;

// Validate KMS_SECRET_KEY
if (!KMS_SECRET_KEY || KMS_SECRET_KEY.length !== 64 || !/^[0-9a-fA-F]+$/.test(KMS_SECRET_KEY)) {
    console.error("FATAL: KMS_SECRET_KEY in .env file must be a valid 64-character hex string (32 bytes)!");
    console.error("Generate one using: openssl rand -hex 32");
    process.exit(1);
}


async function _initializeVeramoAgent() {
    console.log('[Cloud Agent] Initializing Veramo Agent with TypeORM/sqlite3...');
    try {
        // 1. Configure TypeORM DataSource
        const dbConnection = new DataSource({
            type: 'sqlite',
            database: DB_FILENAME,
            entities: Entities,
            migrations: migrations,
            migrationsRun: true,
            synchronize: false,
            logging: ['error', 'warn'],
        });
        await dbConnection.initialize();
        console.log('[Cloud Agent] Database connection initialized.');

        // 2. Create Resolver Instance
        const webResolver = getWebResolver();
        const didResolver = new Resolver({ ...webResolver });

        // 3. Prepare Agent Plugins
        const agentPlugins = [
             new KeyManager({ store: new KeyStore(dbConnection), kms: { local: new KeyManagementSystem(new PrivateKeyStore(dbConnection, new SecretBox(KMS_SECRET_KEY))) } }),
             new DIDManager({ store: new DIDStore(dbConnection), defaultProvider: 'did:key', /* Changed default back to key for simplicity */ providers: { 'did:key': new KeyDIDProvider({ defaultKms: 'local' }), 'did:web': new WebDIDProvider({ defaultKms: 'local' }) } }),
             new DIDResolverPlugin({ resolver: didResolver }),
             new MessageHandler({ messageHandlers: [ new DIDCommMessageHandler() ] }),
             new DIDComm(),
             // Add DataStore if needed: new DataStore(dbConnection)
        ];

        // 4. Create Veramo Agent instance - NO TYPESCRIPT ANNOTATION
        console.log('[Cloud Agent] Creating Veramo agent instance...');
        agent = createAgent({ // REMOVED <...> type hint
            plugins: agentPlugins,
        });
        console.log('[Cloud Agent] Veramo agent created.');

        // 5. Check/Create Agent's did:key and Service Endpoint
 // src/agent.js (inside _initializeVeramoAgent)

        // 5. === Check/Create Agent's did:key and Service Endpoint ===
        try {
            // --- TEMPORARY DIAGNOSTIC: Use find instead of get ---
            console.log(`[Cloud Agent] DIAGNOSTIC: Finding DIDs with provider 'did:key'...`);
            const identifiers = await agent.didManagerFind({ provider: 'did:key' }); // Use find
            console.log(`[Cloud Agent] DIAGNOSTIC: didManagerFind result:`, JSON.stringify(identifiers));
            // Attempt to find the specific alias within the results array
            let identifier = identifiers.find(id => id.alias === AGENT_DID_ALIAS);
            // --- END TEMPORARY DIAGNOSTIC ---

            if (identifier) { // Check if we found it in the array
                console.log(`[Cloud Agent] Found existing DID via find: ${identifier.did}`);
                // Check/update service endpoint logic...
                const hasCorrectService = identifier.services?.some(s => s.type === 'DIDCommMessaging' && s.serviceEndpoint === DIDCOMM_SERVICE_ENDPOINT);
                if (!hasCorrectService) {
                     console.log(`[Cloud Agent] DID ${identifier.did} missing/incorrect service. Adding/updating...`);
                     await agent.didManagerAddService({ did: identifier.did, service: { id: `${identifier.did}#didcomm-1`, type: 'DIDCommMessaging', serviceEndpoint: DIDCOMM_SERVICE_ENDPOINT } });
                     console.log(`[Cloud Agent] Service endpoint updated for ${identifier.did}`);
                } else {
                     console.log(`[Cloud Agent] DID ${identifier.did} already has correct service endpoint.`);
                }
            } else {
                 // If find didn't return the alias, throw error to trigger creation in catch block
                 console.log(`[Cloud Agent] Existing DID with alias ${AGENT_DID_ALIAS} not found via find.`);
                 throw new Error('Identifier not found'); // Manually trigger the catch block's creation logic
            }

        } catch (e) {
            // If find failed OR threw 'Identifier not found'...
            if (e.message.includes('Identifier not found')) {
                console.log(`[Cloud Agent] No DID found for alias ${AGENT_DID_ALIAS}. Creating new did:key...`);
                const newIdentifier = await agent.didManagerCreate({ alias: AGENT_DID_ALIAS, provider: 'did:key', kms: 'local' });
                console.log(`[Cloud Agent] Created new DID: ${newIdentifier.did} with alias ${AGENT_DID_ALIAS}`);

            } else {
                // Handle other potential errors during find or addService
                console.error(`[Cloud Agent] Error checking/creating/updating agent DID:`, e);
                throw e; // Re-throw significant errors
            }
        }
        // =========================================================

        console.log('[Cloud Agent] Agent initialization finished successfully.');
        return agent;

    } catch (error) {
        console.error('FATAL: Failed to initialize Veramo agent:', error);
        initializationPromise = null;
        throw error;
    }
}

// Singleton pattern
async function getAgent() {
    if (agent) return agent;
    if (!initializationPromise) initializationPromise = _initializeVeramoAgent();
    try {
        agent = await initializationPromise;
        if (!agent) throw new Error("Agent initialization promise resolved but agent is still null.");
        return agent;
    } catch (error) {
        initializationPromise = null;
        throw error;
    }
}

// Export only the getAgent function
export { getAgent, AGENT_DID_ALIAS };