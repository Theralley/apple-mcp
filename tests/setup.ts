import { beforeAll, afterAll, setDefaultTimeout } from "bun:test";

// Creating the test folder/list/calendar can take several seconds per app
setDefaultTimeout(120_000);
import { TEST_DATA } from "./fixtures/test-data.js";
import { createTestDataManager } from "./helpers/test-utils.js";

const testDataManager = createTestDataManager();

beforeAll(async () => {
  console.log("🔧 Setting up Apple MCP integration tests...");
  
  try {
    // Set up test data in Apple apps
    await testDataManager.setupTestData();
    console.log("✅ Test data setup completed");
  } catch (error) {
    console.error("❌ Failed to set up test data:", error);
    throw error;
  }
});

afterAll(async () => {
  console.log("🧹 Cleaning up Apple MCP test data...");
  
  try {
    // Clean up test data from Apple apps
    await testDataManager.cleanupTestData();
    console.log("✅ Test data cleanup completed");
  } catch (error) {
    console.error("⚠️ Failed to clean up test data:", error);
    // Don't throw here to avoid masking test results
  }
});

export { TEST_DATA };