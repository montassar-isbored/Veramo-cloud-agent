// scripts/get-agent-info.js
// CORRECTED: Uses didManagerFind workaround

import { getAgent, AGENT_DID_ALIAS } from '../src/agent.js'; // Import agent getter and alias

async function showAgentInfo() {
  try {
    console.log("Initializing agent to retrieve info...");
    const agent = await getAgent(); // Ensure agent is initialized
    console.log(`Agent initialized.`);

    // Use FIND with alias and provider to get the identifier object
    console.log(`Finding DID for alias: ${AGENT_DID_ALIAS} with provider did:key...`);
    const identifiers = await agent.didManagerFind({
        alias: AGENT_DID_ALIAS,
        provider: 'did:key'
    });

    if (!identifiers || identifiers.length === 0) {
        throw new Error(`Could not find identifier with alias ${AGENT_DID_ALIAS} using FIND.`);
    }

    // Assume alias is unique, take the first result
    const identifier = identifiers[0];
    const agentDid = identifier.did;
    console.log(`\nCloud Agent DID found via Find: ${agentDid}`);

    // Attempt to resolve to check services (still expect none for did:key)
    console.log(`\nResolving DID document for ${agentDid}...`);
    const resolvedDid = await agent.resolveDid({ didUrl: agentDid });

    let endpoint = `http://localhost:${process.env.PORT || 3000}/didcomm`; // Default endpoint
    let serviceFound = false;

    if (resolvedDid?.didDocument?.service) {
        const didCommService = resolvedDid.didDocument.service.find(
            (service) => service.type === 'DIDCommMessaging'
        );
        if (didCommService?.serviceEndpoint) {
             endpoint = Array.isArray(didCommService.serviceEndpoint) ? didCommService.serviceEndpoint[0] : didCommService.serviceEndpoint; // Handle potential array
             console.log(`Service endpoint found in resolved DID Doc: ${endpoint}`);
             serviceFound = true;
        }
    }

    if (!serviceFound) {
        console.warn(`\nWARNING: No 'DIDCommMessaging' service endpoint found in resolved DID document for ${agentDid}.`);
        console.warn(`Using default endpoint based on server config: ${endpoint}`);
    }

    console.log(`\n--- Info needed for Wallet Connection ---`);
    console.log(`Agent DID: ${agentDid}`);
    console.log(`DIDComm Endpoint: ${endpoint}`); // Output the determined endpoint
    console.log(`----------------------------------------`);

    process.exit(0);

  } catch (error) {
    console.error("\n--- Error retrieving agent info ---");
    console.error(error);
    process.exit(1);
  }
}

showAgentInfo();