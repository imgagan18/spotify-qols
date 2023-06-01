// @ts-check
/// <reference path="../globals.d.ts" />

(async function discover() {
  let maxTries = 200;
  const retryWaitMS = 300; // 0.3 * 1000
  const namespace = "explore";
  const statusKey = `${namespace}:status`;
  const exploredKey = `${namespace}:explored`;
  const readIntervalMS = 100; // 0.1 * 1000
  const trackProgressThresholdMS = 30 * 1000;
  let isEnabled = true;
  let exploredTracks = [];

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
   * Enum for log levels.
   * @readonly
   * @enum {string}
   */
  const Level = {
    TRACE: "TRACE",
    DEBUG: "DEBUG",
    INFO: "INFO",
    WARNING: "WARNING",
    ERROR: "ERROR",
  };

  /**
   * Format and log a message to the console.
   * Also display it as a notifaction in Spotify if its a warning or an error.
   * @param {Level} level - The level of the log.
   * @param {string} message - The message to log.
   * @returns {void}
   * @todo Add a report button to the UI for warnings and errors.
   */
  function log(level, message) {
    console.log(`[${level}] ${message}`);
    if (level === Level.WARNING || level === Level.ERROR) {
      Spicetify.showNotification(
        `${level}: ${message}\nPlease file an issue on GitHub.`,
      );
    }
  }

  /**
   * Doesn't resolve until the required Spicetify methods are loaded.
   * @returns {Promise<void>}
   */
  async function waitUntilReady() {
    let initTries = 1;
    log(Level.TRACE, "Waiting until Spicetify is loaded.");

    while (true) {
      const spiceDependencies = [
        Spicetify?.Platform,
        Spicetify?.React,
        Spicetify?.LocalStorage?.get,
        Spicetify?.LocalStorage?.set,
        Spicetify?.Player?.getProgress,
        Spicetify?.Player?.isPlaying,
        Spicetify?.Player?.next,
        Spicetify?.URI?.fromString,
        Spicetify?.showNotification,
      ];

      if (!spiceDependencies.every((dep) => dep)) {
        if (initTries < maxTries) {
          await sleep(retryWaitMS);
          initTries++;
        } else {
          // The notification may fail, but we want to still at least log
          // this to the console.
          log(
            Level.ERROR,
            `Spicetify hasn't loaded after ${maxTries} try/tries.`,
          );
          maxTries *= 2;
        }
      } else {
        log(Level.TRACE, `Took ${initTries} try/tries to load Spicetify`);
        return;
      }
    }
  }

  /**
   * Saves the current enabled status into local storage.
   * @returns {void}
   */
  function saveStatus() {
    Spicetify.LocalStorage.set(statusKey, JSON.stringify(isEnabled));
  }

  /**
   * Saves the currently explored tracks into local storage.
   * @returns {void}
   */
  function saveExplored() {
    Spicetify.LocalStorage.set(exploredKey, JSON.stringify(exploredTracks));
  }

  /**
   * Clears the list of explored tracks.
   * Also, saves it to local storage.
   * @returns {void}
   */
  function clearExploredData() {
    log(Level.INFO, "Clearing explored tracks.");
    exploredTracks = [];
    saveExplored();
  }

  /**
   * Retrive the saved data from local storage.
   * If the data is not saved or invalid, update it.
   * @returns {void}
   */
  function initializeLocalData() {
    const storageStatus = Spicetify.LocalStorage.get(statusKey);
    if (storageStatus) {
      const parsed = JSON.parse(storageStatus);
      if (parsed && (parsed === true || parsed === false)) {
        isEnabled = parsed;
      } else {
        saveStatus();
        log(Level.WARNING, `Fixed old status (Previously: ${storageStatus}).`);
      }
    } else {
      saveStatus();
      log(Level.TRACE, "Set initial status.");
    }

    const exploredString = Spicetify.LocalStorage.get(exploredKey);
    if (exploredString) {
      const parsed = JSON.parse(exploredString);
      if (parsed && Array.isArray(parsed)) {
        exploredTracks = parsed;
      } else {
        saveExplored();
        log(
          Level.WARNING,
          `Fixed old explored tracks (Previously: ${exploredString}).`,
        );
      }
    } else {
      saveExplored();
      log(Level.TRACE, "Set initial explored tracks.");
    }
  }

  /**
   * Adds the provided track ID to the list of explored tracks.
   * Also, saves it to local storage.
   * @param {string} id - The ID of the track to mark as explored.
   * @returns {void}
   */
  function markTrackAsExplored(id) {
    log(Level.INFO, `Marking track as explored: ${id}`);
    exploredTracks.push(id);
    saveExplored();
  }

  /**
   * Asserts that the provided value is not null or undefined.
   * @param {*} val
   * @returns {*}
   * @throws {Error} If the value is null or undefined.
   */
  function check(val) {
    if (val === null || val === undefined) {
      throw new Error("Val wasn't supposed to be null.");
    }
    return val;
  }

  /**
   * This checks the player state in an interval, and handles states.
   * It adds the tracks to the list of explored tracks when the progress
   * threshold is met.
   * @returns {Promise<void>}
   */
  async function handleStates() {
    let previousPlayerState = null;
    let totalRoughTrackProgress = 0;
    let currentRoughTrackProgress = 0;
    let trackJustSaved = false;

    while (true) {
      const { data } = Spicetify.Player;

      let state = null;
      if (data && data.track) {
        if (
          data.track.uri === null
          || data.timestamp === null
          || data.position_as_of_timestamp === null
          || data.is_paused === null
        ) {
          throw new Error(`Returned data doesn't have expected values.\n${data}`);
        }

        state = {
          is_playing: !data.is_paused,
          position_at_ts: data.position_as_of_timestamp,
          timestamp: data.timestamp,
          trackURI: Spicetify.URI.fromString(data.track.uri),
        };
      }

      const sameState = previousPlayerState?.timestamp === state?.timestamp;
      log(Level.TRACE, `Same state: ${sameState}.`);
      // Can this track potentially be saved?
      let potentialSave = false;

      if (!trackJustSaved && previousPlayerState?.is_playing) {
        if (sameState) {
          // A track is playing, keep computing it's rough progress.
          // This is to ensure that long running songs are still saved.
          currentRoughTrackProgress = Date.now() - check(previousPlayerState.timestamp);
          log(Level.TRACE, `Current rough track progress: ${currentRoughTrackProgress / 1000}s.`);
          potentialSave = true;
        } else {
          // Some event has transpired. Perhaps the song has been paused, progressed or changed.
          // In all of these cases we want to add to the track's total progress.
          if (state !== null) {
            // This is the actual play time
            const accurateProgress = check(state.timestamp) - check(previousPlayerState.timestamp);
            totalRoughTrackProgress += accurateProgress;
            log(Level.TRACE, `Added accurate progress: ${accurateProgress / 1000}. Total: ${totalRoughTrackProgress / 1000}.`);
          } else {
            // If we don't have it, use the newest computed rough value.
            log(Level.TRACE, `Added rough progress: ${currentRoughTrackProgress / 1000}. Total: ${totalRoughTrackProgress / 1000}.`);
            totalRoughTrackProgress += currentRoughTrackProgress;
          }

          currentRoughTrackProgress = 0;
          potentialSave = true;
        }
      }

      if (
        potentialSave
        && currentRoughTrackProgress + totalRoughTrackProgress >= trackProgressThresholdMS
      ) {
        log(Level.TRACE, "Threshold met, saving track.");
        markTrackAsExplored(check(previousPlayerState.trackURI.id));
        trackJustSaved = true;
      }

      if (!sameState && state?.trackURI?.id !== previousPlayerState?.trackURI?.id) {
        log(Level.TRACE, "Track changed. Resetting values.");
        totalRoughTrackProgress = 0;
        currentRoughTrackProgress = 0;
        trackJustSaved = false;

        if (exploredTracks.includes(check(state.trackURI.id))) {
          log(Level.TRACE, "New track has been explored, changing tracks.");
          Spicetify.Player.next();
        }
      }

      previousPlayerState = state;
      await sleep(readIntervalMS);
    }
  }

  /**
   * Used for debugging.
   * Prints useful information about player state in an interval.
   * @returns {Promise<void>}
   * @todo Improve this, and ;properly handle null values.
   */
  async function printPlayerStates() {
    let previousTimestamp = null;
    const previousPosition = null;

    while (1) {
      const { data } = Spicetify.Player;
      if (previousTimestamp !== null) {
        const date = new Date(data.timestamp);
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();

        const formattedTimestamp = `${minutes}:${seconds}`;
        const position = data.position_as_of_timestamp / 1000;
        const formattedPosition = `${Math.floor(position / 60)}:${Math.floor(
          position % 60,
        )}`;
        console.log(
          `${data.timestamp}, ${data.position_as_of_timestamp}, ${formattedTimestamp}, ${formattedPosition}, ${data.is_paused}`,
        );
      }

      previousTimestamp = data.timestamp;
      await sleep(readIntervalMS);
    }
  }

  /**
   * Initializes the config, loads the UI, and handles player states.
   * @returns {Promise<void>}
   */
  async function main() {
    await waitUntilReady();
    initializeLocalData();

    await handleStates();
  }

  await main();
}());
