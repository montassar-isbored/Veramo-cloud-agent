// src/agent.js
// Version with TypeScript syntax removed for plain Node.js execution

import { createAgent } from '@veramo/core';
// Interfaces can be removed if not used for type hinting anymore
// import { IAgent, IKeyManager, IDIDManager, IDataStore, IResolver, IMessageHandler } from '@veramo/core-types';
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
import { DIDComm, DIDCommMessageHandler } from '@veramo/did-comm'; // Removed IDIDComm type if not used

import { DataSource } from 'typeorm';
import 'reflect-metadata'; // Required for TypeORM decorators
import dotenv from 'dotenv';

dotenv.config(); // Load .env file variables

// --- Agent Setup ---
let agent = null;
let initializationPromise = null;

const DB_FILENAME = './database.sqlite'; // SQLite file in project root
// Load secret key from environment - CRITICAL for security
const KMS_SECRET_KEY = process.env.KMS_SECRET_KEY;

// Validate KMS_SECRET_KEY (ensure it's set and looks like a hex key)
if (!KMS_SECRET_KEY) {
    console.error("FATAL: KMS_SECRET_KEY environment variable is not set! Create a .env file or set the variable.");
    process.exit(1);
}
if (KMS_SECRET_KEY.length !== 64 || !/^[0-9a-fA-F]+$/.test(KMS_SECRET_KEY)) {
     console.error("FATAL: KMS_SECRET_KEY must be a 64-character hex string (32 bytes)!");
     console.error("Please generate one using a secure method (e.g., openssl rand -hex 32).");
     process.exit(1);
}

async function _initializeVeramoAgent() {
    console.log('[Cloud Agent] Initializing Veramo Agent with TypeORM/sqlite3...');
    try {
        // 1. Configure TypeORM DataSource for SQLite (Node.js)
        const dbConnection = new DataSource({
            type: 'sqlite',
            database: DB_FILENAME,
            entities: Entities, // Veramo TypeORM entities
            migrations: migrations, // Veramo TypeORM migrations
            migrationsRun: true, // Run migrations automatically
            synchronize: false, // Use migrations, not auto-sync schema
            logging: ['error', 'warn'], // Adjust logging level
        });

        await dbConnection.initialize(); // Initialize TypeORM connection
        console.log('[Cloud Agent] Database connection initialized.');

        // 2. Create Resolver Instance
        const webResolver = getWebResolver();
        const didResolver = new Resolver({
             ...webResolver
             // did:key resolution is often handled implicitly by Veramo's DIDResolverPlugin
             // if the KeyDIDProvider is available in DIDManager.
        });

        // 3. Prepare Agent Plugins
        const agentPlugins = [
            new KeyManager({
                store: new KeyStore(dbConnection), // TypeORM KeyStore
                kms: {
                    local: new KeyManagementSystem(
                        new PrivateKeyStore(dbConnection, new SecretBox(KMS_SECRET_KEY)) // TypeORM PrivateKeyStore
                    ),
                },
            }),
            new DIDManager({
                store: new DIDStore(dbConnection), // TypeORM DIDStore
                defaultProvider: 'did:web', // Default DID method for this agent
                providers: {
                    'did:key': new KeyDIDProvider({ defaultKms: 'local' }),
                    'did:web': new WebDIDProvider({ defaultKms: 'local' })
                },
            }),
            new DIDResolverPlugin({ // Handles resolving DIDs
                resolver: didResolver
            }),
            new MessageHandler({ // Core message handling logic
                messageHandlers: [
                    new DIDCommMessageHandler(), // Handles DIDComm packing/unpacking
                    // Add other specific message handlers here (e.g., for Mediation)
                ]
            }),
            new DIDComm(), // Plugin for sending/receiving DIDComm messages
            // Add DataStore plugin if needed for direct ORM access: new DataStore(dbConnection)
            // Add MediationManager plugin later if this agent acts as mediator
        ];

        // 4. Create Veramo Agent instance (without TypeScript generic)
        console.log('[Cloud Agent] Creating Veramo agent instance...');
        agent = createAgent({ // REMOVED <CloudAgentType> annotation
            plugins: agentPlugins,
        });
        console.log('[Cloud Agent] Veramo agent created.');

        // 5. Optional: Check/Create Cloud Agent's DID on first run
        const agentDids = await agent.didManagerFind({ provider: 'did:web' });
        if (agentDids.length === 0) {
            console.warn('[Cloud Agent] No did:web found. Configure your domain and create one.');
            // Example (requires more setup like hosting .well-known/did.json):
            // try {
            //    const newDid = await agent.didManagerCreate({ alias: 'default', provider: 'did:web', options: { url: 'https://your-domain.com' }})
            //    console.log('[Cloud Agent] Created did:web:', newDid.did);
            // } catch (e) { console.error("Failed to create did:web (requires server setup)", e)}
        } else {
            console.log(`[Cloud Agent] Found existing DID: ${agentDids[0].did}`);
        }

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

// Export only the getAgent function for the server to use
export { getAgent };