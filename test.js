const assert = require('assert');
const { executeAgent } = require('./agent-logic.js');

// --- Mocks ---
let dbLog = [];
const mockDb = {
    run: async (sql, params) => {
        dbLog.push({ sql, params });
        return { lastID: 1 }; // Return a mock ID
    }
};

let modelLog = [];
const mockModel = {
    getGenerativeModel: () => mockModel, // Chainable
    startChat: (options) => {
        modelLog.push({ type: 'startChat', options });
        return {
            sendMessage: async (message) => {
                modelLog.push({ type: 'sendMessage', message });
                return {
                    response: {
                        text: () => `Mocked response to: ${message}`
                    }
                };
            }
        };
    }
};


// --- Test Runner ---
async function runTests() {
    console.log("Running tests for executeAgent...");

    // Reset logs
    dbLog = [];
    modelLog = [];

    // Test data
    const chatId = 123;
    const context = "This is the initial context.";
    const steps = ["Step 1: Do something.", "Step 2: Do something else."];

    // Execute the function under test
    await executeAgent(chatId, context, steps, mockDb, mockModel);

    // --- Assertions ---
    console.log("Running assertions...");

    // 1. Check if the database was updated correctly
    // It should be called once for the initial history, once for each step's result, and once for the final status.
    // Total = 1 (initial) + 2 (steps) + 1 (completed status) = 4
    assert.strictEqual(dbLog.length, 4, `Expected 4 DB calls, but got ${dbLog.length}`);

    // Check the first call (initial history)
    assert.ok(dbLog[0].sql.includes('UPDATE chats SET history = ? WHERE id = ?'), 'First DB call should be to set initial history.');
    assert.deepStrictEqual(dbLog[0].params, [JSON.stringify([{ role: 'user', parts: [{ text: `**Contexto Inicial Fornecido:**\n\n>${context.replace(/\n/g, '\n>')}\n\n---` }] }]), chatId], 'Initial history params are incorrect.');

    // Check the last call (status update)
    assert.deepStrictEqual(dbLog[dbLog.length - 1].sql, "UPDATE chats SET status = 'completed' WHERE id = ?", 'Last DB call should be to set status to completed.');
    assert.deepStrictEqual(dbLog[dbLog.length - 1].params, [chatId], 'Chat ID for status update is incorrect.');

    // 2. Check if the AI model was called correctly
    // Should be called once for each step
    assert.strictEqual(modelLog.filter(c => c.type === 'sendMessage').length, 2, `Expected 2 sendMessage calls, but got ${modelLog.filter(c => c.type === 'sendMessage').length}`);
    assert.strictEqual(modelLog[1].message, 'Step 1: Do something.', 'First message to AI is incorrect.');
    assert.strictEqual(modelLog[3].message, 'Step 2: Do something else.', 'Second message to AI is incorrect.');

    console.log("All tests passed! ✅");
}

runTests().catch(error => {
    console.error("Test failed! ❌");
    console.error(error);
    process.exit(1); // Exit with error code
});
