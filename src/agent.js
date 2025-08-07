// src/agent.js (Cloud Agent - Using In-Memory Mediation Stores)

import { createAgent } from '@veramo/core';
import { KeyManager } from '@veramo/key-manager';
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local';
import { DIDManager } from '@veramo/did-manager';
import { KeyStore, DIDStore, PrivateKeyStore, migrations as dataStoreMigrations, Entities as DataStoreEntities } from '@veramo/data-store';
import { KeyValueStore, KeyValueTypeORMStoreAdapter } from '@veramo/kv-store';
import { KeyDIDProvider } from '@veramo/did-provider-key';
import { WebDIDProvider } from '@veramo/did-provider-web';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { Resolver } from 'did-resolver';
import { getResolver as getWebResolver } from 'web-did-resolver';
import { getResolver as getKeyResolver } from 'key-did-resolver';
import { MessageHandler } from '@veramo/message-handler';
import { DIDComm } from '@veramo/did-comm';
import { MediationManagerPlugin } from '@veramo/mediation-manager';

import { DataSource } from 'typeorm';
import 'reflect-metadata';
import dotenv from 'dotenv';

dotenv.config();

// --- Agent Setup ---
let agent = null;
let initializationPromise = null;

const DB_FILENAME = process.env.DB_FILENAME || './database.sqlite';
const KMS_SECRET_KEY = process.env.KMS_SECRET_KEY;
const AGENT_DID_ALIAS = process.env.AGENT_DID_ALIAS || 'cloud-agent-default-key';

// Validate KMS_SECRET_KEY
if (!KMS_SECRET_KEY || KMS_SECRET_KEY.length !== 64 || !/^[0-9a-fA-F]+$/.test(KMS_SECRET_KEY)) {
    console.error("FATAL: KMS_SECRET_KEY in .env file must be a valid 64-character hex string (32 bytes)!");
    process.exit(1);
}

async function _initializeVeramoAgent() {
    console.log('[Cloud Agent] Initializing Veramo Agent...');
    try {
        // 1. Configure TypeORM DataSource (used for KeyManager, DIDManager)
        const dbConnection = new DataSource({
            type: 'sqlite',
            database: DB_FILENAME,
            entities: DataStoreEntities,
            migrations: dataStoreMigrations,
            migrationsRun: true,
            synchronize: false,
            logging: ['error', 'warn'],
        });
        await dbConnection.initialize();
        console.log('[Cloud Agent] Database connection initialized.');

        // 2. Create Resolver Instance
        const webResolver = getWebResolver();
        const keyResolver = getKeyResolver();
        const didResolver = new Resolver({
            ...webResolver,
            ...keyResolver 
        });

        // 3. Create IN-MEMORY KV Store instances for Mediation Manager
        // NOTE: This is a workaround for the KeyValueTypeORMStoreAdapter issue.
        console.log('[Cloud Agent] Using IN-MEMORY KeyValueStores for MediationManagerPlugin.');
        const policyStore = new KeyValueStore({ store: new Map(), namespace: 'mediation-policy' });
        const mediationResponseStore = new KeyValueStore({ store: new Map(), namespace: 'mediation-response' });
        const recipientDidStore = new KeyValueStore({ store: new Map(), namespace: 'recipient-did' });

        // 4. Instantiate plugins
        const didCommPlugin = new DIDComm();
        const mediationManager = new MediationManagerPlugin(
            true, // isMediateDefaultGrantAll
            policyStore,
            mediationResponseStore,
            recipientDidStore
        );

        // 5. Prepare Agent Plugins List
        const agentPlugins = [
             new KeyManager({ 
                 store: new KeyStore(dbConnection),
                 kms: { 
                     local: new KeyManagementSystem(
                         new PrivateKeyStore(dbConnection, new SecretBox(KMS_SECRET_KEY))
                     ) 
                 } 
             }),
             new DIDManager({ 
                 store: new DIDStore(dbConnection),
                 defaultProvider: 'did:key', 
                 providers: { 
                     'did:key': new KeyDIDProvider({ defaultKms: 'local' }), 
                     'did:web': new WebDIDProvider({ defaultKms: 'local' }) 
                 } 
             }),
             new DIDResolverPlugin({ resolver: didResolver }),
             new MessageHandler({ messageHandlers: [] }), 
             didCommPlugin,
             mediationManager,
        ];

        // 6. Create Veramo Agent instance
        console.log('[Cloud Agent] Creating Veramo agent instance...');
        agent = createAgent({
            plugins: agentPlugins,
        });
        console.log('[Cloud Agent] Veramo agent created.');

        // 7. Check/Create Agent's primary did:key
        console.log(`[Cloud Agent] Ensuring mediator DID with alias ${AGENT_DID_ALIAS} exists...`);
        try {
            let identifiers = await agent.didManagerFind({ alias: AGENT_DID_ALIAS, provider: 'did:key' });
            if (identifiers.length > 0) {
                console.log(`[Cloud Agent] Found existing mediator DID: ${identifiers[0].did}`);
            } else {
                const newIdentifier = await agent.didManagerCreate({ alias: AGENT_DID_ALIAS, provider: 'did:key', kms: 'local' });
                console.log(`[Cloud Agent] Created new mediator DID: ${newIdentifier.did} with alias ${AGENT_DID_ALIAS}`);
            }
        } catch (e) {
             console.error(`[Cloud Agent] CRITICAL: Error during mediator DID find/create process:`, e);
             throw e;
        }

        console.log('[Cloud Agent] Agent initialization finished successfully.');
        return agent;

    } catch (error) {
        console.error('FATAL: Failed to initialize Veramo agent:', error.message);
        console.error(error.stack); 
        initializationPromise = null; 
        throw error;
    }
}

// Singleton pattern for getting the agent instance
async function getAgent() {
    if (agent) return agent;
    if (!initializationPromise) initializationPromise = _initializeVeramoAgent();
    try {
        agent = await initializationPromise;
        if (!agent) {
            console.error("getAgent: Initialization promise resolved but agent is null/undefined.");
            initializationPromise = null; 
            throw new Error("Agent initialization failed to produce an agent instance.");
        }
        return agent;
    } catch (error) {
        initializationPromise = null; 
        throw error;
    }
}

export { getAgent, AGENT_DID_ALIAS };