#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'YOU> '
});

const client = new Client({
    name: "CLI Client",
    version: "1.0.0",
}, {
    capabilities: {}
});

async function init() {
    try {

        const transport = new StdioClientTransport({
            command: "node",
            args: ["server.js"]
        });


        await client.connect(transport);
        console.log('Connected to MCP server successfully!\n');

        // Verify tool availability
        const tools = await client.listTools();

        console.log('Available tools:');
        tools.tools.forEach(tool => {
            console.log(`- ${tool.name}: ${tool.description || 'No description'}`);
        });
        console.log('\nType your requests or "exit" to quit.\n');

        rl.prompt();
    } catch (error) {
        console.error('Initialization failed:', error);
        process.exit(1);
    }
}

rl.on('line', async (line) => {
    const input = line.trim();

    if (input.toLowerCase() === 'exit') {
        cleanup();
        return;
    }

    if (input) {
        try {
            console.log(`Sending request: "${input}"`);
            const response = await client.callTool({
                name: 'processUserRequest',
                arguments: {
                    userInput: input
                }
            });

            console.log(`\nASSISTANT> ${response.content[0].text}\n`);
        } catch (err) {
            console.error(`\nERROR> ${err.message}\n`);
        }
    }

    rl.prompt();
});

rl.on('close', cleanup);

function cleanup() {
    console.log('\n[Client] Shutting down...');
    client.close().catch(err => {
        console.error('[Client] Error during disconnect:', err);
    });
    rl.close();
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

init();