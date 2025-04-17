// src/agent.js
// FINAL CORRECTED VERSION #5 - Fixes KV Store imports AND DataSource config

import { createAgent } from '@veramo/core';
// Interfaces removed

import { KeyManager } from '@veramo/key-manager';
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local';
import { DIDManager } from '@veramo/did-manager';
// CORRECT imports for DataStore Entities/Migrations
import { KeyStore, DIDStore, PrivateKeyStore, migrations as dataStoreMigrations, Entities as DataStoreEntities } from '@veramo/data-store';
// CORRECT imports for KeyValue Store - ONLY the needed classes
import { KeyValueStore, KeyValueTypeORMStoreAdapter } from '@veramo/kv-store';
import { KeyDIDProvider } from '@veramo/did-provider-key';
import { WebDIDProvider } from '@veramo/did-provider-web';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { Resolver } from 'did-resolver';
import { getResolver as getWebResolver } from 'web-did-resolver';
import { MessageHandler } from '@veramo/message-handler';
import { DIDComm, DIDCommMessageHandler } from '@veramo/did-comm';
import { MediationManagerPlugin } from '@veramo/mediation-manager';

import { DataSource } from 'typeorm';
import 'reflect-metadata';
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
    process.exit(1);
}

async function _initializeVeramoAgent() {
    console.log('[Cloud Agent] Initializing Veramo Agent with TypeORM/sqlite3 + Mediation...');
    try {
        // 1. Configure TypeORM DataSource using ONLY data-store Entities/Migrations
        const dbConnection = new DataSource({
            type: 'sqlite',
            database: DB_FILENAME,
            // === Use ONLY Entities/migrations from @veramo/data-store ===
            entities: DataStoreEntities,
            migrations: dataStoreMigrations,
            // ============================================================
            migrationsRun: true,
            synchronize: false,
            logging: ['error', 'warn'],
        });
        await dbConnection.initialize();
        console.log('[Cloud Agent] Database connection initialized.');

        // 2. Create Resolver Instance
        const webResolver = getWebResolver();
        const didResolver = new Resolver({ ...webResolver });

        // 3. Create KV Store Adapter using the initialized connection
        const kvStoreAdapter = new KeyValueTypeORMStoreAdapter(dbConnection);

        // 4. Create KV Store instances for Mediation Manager using the adapter
        const policyStore = new KeyValueStore({ store: kvStoreAdapter, namespace: 'mediation-policy' });
        const mediationResponseStore = new KeyValueStore({ store: kvStoreAdapter, namespace: 'mediation-response' });
        const recipientDidStore = new KeyValueStore({ store: kvStoreAdapter, namespace: 'recipient-did' });

        // 5. Prepare Agent Plugins List
        const agentPlugins = [
             new KeyManager({ store: new KeyStore(dbConnection), kms: { local: new KeyManagementSystem(new PrivateKeyStore(dbConnection, new SecretBox(KMS_SECRET_KEY))) } }),
             new DIDManager({ store: new DIDStore(dbConnection), defaultProvider: 'did:key', providers: { 'did:key': new KeyDIDProvider({ defaultKms: 'local' }), 'did:web': new WebDIDProvider({ defaultKms: 'local' }) } }),
             new DIDResolverPlugin({ resolver: didResolver }),
             new MessageHandler({ messageHandlers: [ new DIDCommMessageHandler() ] }),
             new DIDComm(),
             new MediationManagerPlugin(true), // Add mediation manager plugin
             // Add the specific KV store instances as plugins
             policyStore,
             mediationResponseStore,
             recipientDidStore,
        ];

        // 6. Create Veramo Agent instance (No TS types)
        console.log('[Cloud Agent] Creating Veramo agent instance...');
        agent = createAgent({
            plugins: agentPlugins,
        });
        console.log('[Cloud Agent] Veramo agent created.');

        // 7. Check/Create Agent's did:key using FIND workaround
        console.log(`[Cloud Agent] Checking for existing DID with alias ${AGENT_DID_ALIAS} using FIND...`);
        try {
            const identifiers = await agent.didManagerFind({ provider: 'did:key', alias: AGENT_DID_ALIAS });
            console.log(`[Cloud Agent] didManagerFind result for alias:`, JSON.stringify(identifiers));
            if (identifiers.length > 0) {
                let identifier = identifiers[0];
                console.log(`[Cloud Agent] Found existing DID via find: ${identifier.did}`);
            } else {
                console.log(`[Cloud Agent] No DID found for alias ${AGENT_DID_ALIAS}. Creating new did:key...`);
                const newIdentifier = await agent.didManagerCreate({ alias: AGENT_DID_ALIAS, provider: 'did:key', kms: 'local' });
                console.log(`[Cloud Agent] Created new DID: ${newIdentifier.did} with alias ${AGENT_DID_ALIAS}`);
            }
        } catch (e) {
             console.error(`[Cloud Agent] Unexpected error during DID find/create process:`, e);
             throw e;
        }

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