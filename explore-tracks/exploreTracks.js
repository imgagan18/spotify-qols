// @ts-check
/// <reference path="../globals.d.ts" />

(async function discover() {
  // #region Global Values

  let maxTries = 200;
  const maxTriesBumpLimit = 4; 
  const retryWaitMS = 300; // 0.3 * 1000
  const namespace = "explore";
  const statusKey = `${namespace}:status`;
  const exploredKey = `${namespace}:explored`;
  const readIntervalMS = 100; // 0.1 * 1000
  const trackProgressThresholdMS = 30 * 1000;
  const trackIDRe = /^[a-zA-Z0-9]{18,26}$/; // Has some length leeway

  // App data (with defaults)
  let isEnabled = true;
  let exploredTracks = [];

  // #endregion

  // #region Utils

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
    if (level === Level.WARNING) {
      Spicetify.showNotification(
        `track-explorer ${level}: ${message}.`,
      );
    }
  }

  /**
   * Doesn't resolve until the required Spicetify methods are loaded.
   * @returns {Promise<void>}
   */
  async function waitUntilReady() {
    let initTries = 1;
    let bumpCount = 0;
    log(Level.TRACE, "Waiting until Spicetify is loaded.");

    while (true) {
      const spiceDependencies = [
        Spicetify?.React,
        Spicetify?.LocalStorage?.get,
        Spicetify?.LocalStorage?.set,
        Spicetify?.Player?.getProgress,
        Spicetify?.Player?.isPlaying,
        Spicetify?.Player?.next,
        Spicetify?.URI?.fromString,
        Spicetify?.showNotification,
        Spicetify?.Playbar?.Button,
        Spicetify?.SVGIcons?.search,
        Spicetify?.SVGIcons?.check,
        Spicetify?.Platform?.ClipboardAPI?.paste,
      ];

      if (!spiceDependencies.every((dep) => dep)) {
        if (initTries < maxTries) {
          await sleep(retryWaitMS);
          initTries++;
        } else {
          // The notification may fail, but we want to still at least log
          // this to the console.
          if (bumpCount < maxTriesBumpLimit) {
            bumpCount++;
            log(
              Level.WARNING,
              `Spicetify hasn't loaded after ${maxTries} try/tries.`,
            );
            maxTries *= 2;
          } else {
            throw new Error("Spicetify couldn't load.");
          }
        }
      } else {
        log(Level.TRACE, `Took ${initTries} try/tries to load Spicetify`);
        return;
      }
    }
  }

  /**
   * Asserts that the provided value is not null or undefined.
   * @param {*} val
   * @returns {*}
   * @throws {Error} If the value is null or undefined.
   */
  function check(val) {
    if (val === null || val === undefined) {
      throw new Error("An internal assertion has failed.");
    }
    return val;
  }

  /**
   * Asserts that the provided track IDs are most probably valid Spotify IDs.
   * @param {string[]} trackIDs - The track IDs to check.
   * @returns {boolean} Whether or not the track IDs are valid.
   */
  function areValidTrackIDs(trackIDs) {
    return trackIDs.every((trackID) => trackIDRe.test(trackID));
  }

  // #endregion

  await waitUntilReady();

  // #region Local Storage

  /**
   * Saves the current enabled status into local storage.
   * This function must be called any time the enabled status is modified.
   * Also syncs the state of the playbar button.
   * @returns {void}
   */
  function syncEnabledData() {
    Spicetify.LocalStorage.set(statusKey, JSON.stringify(isEnabled));
    syncBarButtonState();
  }

  /**
   * Saves the provided explored tracks into local storage.
   * This function must be called any time the explored tracks are modified.
   * @returns {void}
   */
  function syncExploredData() {
    Spicetify.LocalStorage.set(exploredKey, JSON.stringify(exploredTracks));
  }

  /**
   * Retrive the saved data from local storage.
   * If the data is not saved or invalid, overwrite it with the default value.
   * @returns {void}
   */
  function initializeLocalData() {
    const storageStatus = Spicetify.LocalStorage.get(statusKey);

    if (storageStatus) {
      let isMalformed = false;

      try {
        const parsed = JSON.parse(storageStatus);
        if (parsed === true || parsed === false) {
          log(Level.TRACE, `Loaded saved status: ${parsed}.`)
          isEnabled = parsed;
        } else {
          isMalformed = true;
        }
      } catch (e) {
        isMalformed = true;
      }

      if (isMalformed) {
        log(Level.WARNING, `Fixed old status (Previously: ${storageStatus}).`);
      }
    } else {
      log(Level.TRACE, "Set default status.");
    }
    syncEnabledData();

    const exploredString = Spicetify.LocalStorage.get(exploredKey);

    if (exploredString) {
      let isMalformed = false;

      try {
        const parsed = JSON.parse(exploredString);
        if (areValidTrackIDs(parsed)) {
          // log number of tracks loaded
          exploredTracks = parsed;
          log(Level.TRACE, `Loaded ${parsed.length} saved explored tracks.`);
        } else {
          isMalformed = true;
        }
      } catch (e) {
        isMalformed = true;
      }

      if (isMalformed) {
        throw new Error("The explored track data in local storage is malformed.");
      }
    } else {
      log(Level.TRACE, "Set default status.");
    }
    syncExploredData();
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
    syncExploredData();
  }

  // #endregion

  // #region Main Logic

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
      const data = isEnabled ? Spicetify.Player.data : null;

      let state = null;
      let trackURI = null;

      if (data != null && data.track != null) {
        trackURI = Spicetify.URI.fromString(data.track.uri);
      }

      if (trackURI?.type === Spicetify.URI.Type.TRACK) {
        // A track is playing, ensure if the rest of the data is valid.
        if (
          data.timestamp == null
          || data.position_as_of_timestamp == null
          || data.is_paused == null
        ) {
          throw new Error("Spotify returned data that doesn't have expected values.");
        } else {
          state = {
            is_playing: !data.is_paused,
            position_at_ts: data.position_as_of_timestamp,
            timestamp: data.timestamp,
            trackURI,
          };
        }
      }
      // If a track wasn't playing or the extension was not enabled, the current state would be
      // null.
      const sameState = previousPlayerState?.timestamp === state?.timestamp;
      log(Level.TRACE, `Same state: ${sameState}.`);
      // if (!sameState) {
      //   console.log(previousPlayerState);
      //   console.log(state);
      // }

      // Can this track potentially be saved?
      let potentialSave = false;

      if (!trackJustSaved && previousPlayerState?.is_playing) {
        if (sameState) {
          // A track is playing, keep computing it's rough progress.
          // This is to ensure that long running songs are still saved.
          currentRoughTrackProgress = Date.now() - check(previousPlayerState.timestamp);
          // This log is extremely verbose, only enable if necessary.
          // log(Level.TRACE, `Current rough track progress: ${currentRoughTrackProgress / 1000}s.`);
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

      if (!sameState && state?.trackURI.id !== previousPlayerState?.trackURI.id) {
        log(Level.TRACE, "Track changed. Resetting values.");
        totalRoughTrackProgress = 0;
        currentRoughTrackProgress = 0;
        trackJustSaved = false;

        if (exploredTracks.includes(state?.trackURI.id)) {
          log(Level.TRACE, "New track has been explored, changing tracks.");
          Spicetify.Player.next();
        }
      }

      previousPlayerState = state;
      await sleep(readIntervalMS);
    }
  }

  // #endregion

  // #region Playbar Button

  const disabledLabel = "Enable discovery mode";
  const enabledLabel = "Disable discovery mode";
  const barButton = new Spicetify.Playbar.Button(
    enabledLabel,
    "search",
    onBarButtonPress,
    false,
    true,
    false,
  );

  /**
   * Toggle the enabled state..
   * @param {Spicetify.Playbar.Button} self
   * @returns {void}
   */
  function onBarButtonPress(self) {
    isEnabled = !isEnabled;
    syncEnabledData();
  }

  /**
   * Changes the button label and active status based on isEnabled.
   * @returns {void}
   */
  function syncBarButtonState() {
    barButton.active = isEnabled;
    barButton.label = isEnabled ? enabledLabel : disabledLabel;
  }

  // #endregion

  // #region Options Menu

  const settingsContent = document.createElement("div");
  const style = document.createElement("style");
  style.innerHTML = `
  .main-trackCreditsModal-container {
    width: auto !important;
    background-color: var(--spice-player) !important;
  }

  .setting-row::after {
    content: "";
    display: table;
    clear: both;
  }
  .setting-row {
    display: flex;
    padding: 10px 0;
    align-items: center;
    justify-content: space-between;
  }
  .setting-row .col.description {
    float: left;
    padding-right: 15px;
    width: 100%;
  }
  .setting-row .col.action {
    float: right;
    text-align: right;
  }
  button.switch {
    align-items: center;
    border: 0px;
    border-radius: 50%;
    background-color: rgba(var(--spice-rgb-shadow), .7);
    color: var(--spice-text);
    cursor: pointer;
    display: flex;
    margin-inline-start: 12px;
    padding: 8px;
  }
  button.switch.disabled,
  button.switch[disabled] {
    color: rgba(var(--spice-rgb-text), .3);
  }
  button.reset {
    font-weight: 700;
    font-size: medium;
    background-color: transparent;
    border-radius: 500px;
    transition-duration: 33ms;
    transition-property: background-color, border-color, color, box-shadow, filter, transform;
    padding-inline: 15px;
    border: 1px solid #727272;
    color: var(--spice-text);
    min-block-size: 32px;
    cursor: pointer;
  }
  button.reset:hover {
    transform: scale(1.04);
    border-color: var(--spice-text);
  }`;
  settingsContent.appendChild(style);

  const header = document.createElement("h2");
  header.innerText = "Options";
  settingsContent.appendChild(header);

  async function exportItems() {
    const data = JSON.stringify(exploredTracks);
    await Spicetify.Platform.ClipboardAPI.copy(data);
    Spicetify.showNotification("Copied explored tracks to clipboard.");
  }

  async function importItems() {
    const newData = await Spicetify.Platform.ClipboardAPI.paste();
    const parsedData = JSON.parse(newData);

    if (
      parsedData && Array.isArray(parsedData) && areValidTrackIDs(parsedData)
    ) {
      exploredTracks = [...new Set([...exploredTracks, ...parsedData])];
      syncExploredData();
      Spicetify.showNotification("Merged new tracks with current data.");
    } else {
      Spicetify.showNotification("The clipboard contains invalid JSON, did you export tracks first?");
    }
  }

  function clearItems() {
    exploredTracks = [];
    syncExploredData();
    Spicetify.showNotification("Cleared all tracks.");
  }

  settingsContent.appendChild(createButtonRow("Export", "Save explored tracks to clipboard.", exportItems));
  settingsContent.appendChild(createButtonRow("Import", "Merge the explored tracks from clipboard with the current data.", importItems));
  settingsContent.appendChild(createButtonRow("Clear ", "Clear all explored tracks data.", clearItems));

  const menuItem = new Spicetify.Menu.Item(
    "Track Explorer",
    false,
    () => {
      Spicetify.PopupModal.display({
        title: "Track Explorer Settings",
        content: settingsContent,
      });
    },
    "search",
  );

  /**
   * Creates a setting row with a button.
   * @param {string} text - The text to display on the button.
   * @param {string} description - The description to display in the row.
   * @param {*} callback - The callback to call when the button is pressed.
   * @returns {HTMLDivElement} The created row.
   */
  function createButtonRow(text, description, callback) {
    const container = document.createElement("div");
    container.classList.add("setting-row");

    container.innerHTML = `
    <label class="col description">${description}</label>
    <div class="col action"><button class="reset">${text}</button></div>
    `;

    const button = check(container.querySelector("button.reset"));
    button.onclick = callback;
    return container;
  }

  // #endregion

  // #region Debugging

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

  // #endregion

  /**
   * Initializes the config, loads the UI, and handles player states.
   * @returns {Promise<void>}
   */
  async function main() {
    await initializeLocalData();
    barButton.register();
    menuItem.register();
    await handleStates();
  }

  await main();
}());
