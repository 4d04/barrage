import { StartPlugin, DefaultConfig, initializeContract } from './contract/plugin.js';
import { Contract, ContractConfig, ContractAsync } from './contract/contract.js';
import { StartRPCServer } from './contract/rpc.js';

initializeContract(Contract, ContractConfig, ContractAsync);
const plugin = StartPlugin(DefaultConfig());
StartRPCServer(plugin);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
