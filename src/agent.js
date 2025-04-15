// src/agent.js
// CORRECTED VERSION #2 - Plain JavaScript for Node.js

import { createAgent } from '@veramo/core';
// Removed Interface imports from @veramo/core-types
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

dotenv.config();

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
             new DIDManager({ store: new DIDStore(dbConnection), defaultProvider: 'did:key', providers: { 'did:key': new KeyDIDProvider({ defaultKms: 'local' }), 'did:web': new WebDIDProvider({ defaultKms: 'local' }) } }),
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

  // src/agent.js (Replace the previous try/catch block for DID check/create)

            // 5. Check/Create Agent's did:key using FIND and direct check
            console.log(`[Cloud Agent] Checking for existing DID with alias ${AGENT_DID_ALIAS} using FIND...`);
            try {
                // Use FIND as it worked reliably to query
                const identifiers = await agent.didManagerFind({
                    provider: 'did:key',
                    alias: AGENT_DID_ALIAS
                });
                console.log(`[Cloud Agent] didManagerFind result for alias:`, JSON.stringify(identifiers));

                // Check the length of the result directly
                if (identifiers.length > 0) {
                    // DID Found
                    let identifier = identifiers[0]; // Assume alias is unique, take the first
                    console.log(`[Cloud Agent] Found existing DID via find: ${identifier.did}`);
                    // No service endpoint logic needed for did:key

                } else {
                    // DID Not Found - Create it directly within the try block
                    console.log(`[Cloud Agent] No DID found for alias ${AGENT_DID_ALIAS}. Creating new did:key...`);
                    const newIdentifier = await agent.didManagerCreate({
                        alias: AGENT_DID_ALIAS,
                        provider: 'did:key',
                        kms: 'local'
                    });
                    console.log(`[Cloud Agent] Created new DID: ${newIdentifier.did} with alias ${AGENT_DID_ALIAS}`);
                    // No service endpoint logic needed here for did:key
                }

            } catch (e) {
                 // Catch only unexpected errors during find or create
                 console.error(`[Cloud Agent] Unexpected error during DID find/create process:`, e);
                 throw e; // Re-throw to indicate initialization failure
            }
            // --- End of DID Check/Create Block ---
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

// Export only the getAgent function and the alias
export { getAgent, AGENT_DID_ALIAS };