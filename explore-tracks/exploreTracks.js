// @ts-check
/// <reference path="../globals.d.ts" />

// Immediately invoked function, to avoid namespace pollution.
(async function discover() {
    const maxTries = 200;
    const retryWaitMS = 300;
    const namespace = "explore";
    const statusKey = `${namespace}:status`;
    let isEnabled = true;
  
    /**
     * Sleep for the provided number of milliseconds.
     * @returns {Promise<void>}
     * @param {number} ms - The number of milliseconds to sleep for.
     * @see https://stackoverflow.com/a/39914235/6828099
     */
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  
    /**
     * Doesn't return until Spicetify is loaded.
     * @returns {Promise<void>}
     * @throws {Error} - If Spicetify hasn't loaded after max tries.
     */
    async function waitUntilReady() {
      let initTries = 1;
      console.log("[TRACE] Waiting until Spicetify is loaded.");
  
      while (1) {
        if (!(Spicetify.Platform && Spicetify.React)) {
          if (initTries < maxTries) {
            await sleep(retryWaitMS);
            initTries++;
          } else {
            throw new Error(
              `Spicetify hasn't loaded after ${maxTries} try/tries.`
            );
          }
        } else {
          console.log(`[TRACE] Took ${initTries} try/tries to load Spicetify`);
          return;
        }
      }
    }
  
    /**
     * Retrive the current enabled status from local storage.
     * If the status is not saved or invalid, set it to "1"
     * @returns {void}
     */
    function initializeStatus() {
      const storageStatus = Spicetify.LocalStorage.get(statusKey);
      if (storageStatus) {
        const parsed = JSON.parse(storageStatus);
        if (parsed && (parsed == 0 || parsed == 1)) {
          isEnabled = parsed;
        } else {
          saveStatus();
          console.log(`[WARNING] Fixed old status (Previously: ${parsed}).`);
        }
      } else {
        saveStatus();
        console.log("[TRACE] Set initial status.");
      }
    }
  
    /**
     * Saves the current config into local storage.
     * @returns {void}
     */
    function saveStatus() {
      Spicetify.LocalStorage.set(statusKey, JSON.stringify(isEnabled));
    }
  
    /**
     * Initializes the config, loads the React UI, and contains all the main application logic.
     */
    async function main() {
      await waitUntilReady();
      initializeStatus();
    }
  
    await main();
  })();
  