/// <reference path="../globals.d.ts" />

const maxTries = 200;
const retryWaitMS = 300;
const sortedFolderName = "Sorted Playlist";
// Starts out with the default config.
let config = {};
const settingsKey = "enhancedSort:settings";


/**
 * Sleep for the provided number of milliseconds. 
 * @returns {Promise<void>}
 * @param {number} ms - The number of milliseconds to sleep for.
 * @see https://stackoverflow.com/a/39914235/6828099
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Doesn't return until Spicetify is loaded.
 * @returns {Promise<void>}
 * @throws {Error} - If Spicetify hasn't loaded after max tries.
 */
async function waitUntilReady() {
  let initTries = 1;
  console.log("[TRACE] Waiting until Spicetify is loaded.");

  while(1) {
    if (!(Spicetify.Platform && Spicetify.React)) {
      if (initTries < maxTries) {
        await sleep(retryWaitMS);
        initTries++;
      } else {
        throw new Error(`Spicetify hasn't loaded after ${maxTries} try/tries.`);
      }
    } 
    else {
      console.log(`[TRACE] Took ${initTries} try/tries to load Spicetify`);
      return;
    }
  }
}

/**
 * If a config has been set in local storage previously, it is loaded.
 * If the local storage config is invalid or not present, it will be set to the default config.
 * @returns {void}
 */
function initializeConfig() {
  try {
    const parsed = JSON.parse(Spicetify.LocalStorage.get(settingsKey));
    if (parsed && typeof parsed === "object") {
      config = parsed;
    } else {
      saveConfig();
      console.log("[WARNING] Fixed old config.");
    }
  } catch {
    console.log("[TRACE] Initial config created.");
    saveConfig();
  }
}

/**
 * Saves the current config into local storage.
 * @returns {void}
 */
function saveConfig() {
  Spicetify.LocalStorage.set(settingsKey, JSON.stringify(config));
}

/**
 * Initializes the config, loads the React UI, and contains all the main application logic.
 */
async function main() {
  await waitUntilReady();
  initializeConfig();
  let { Type } = Spicetify.URI;

  const { React } = Spicetify;
  const { useState } = React;
}

main();
