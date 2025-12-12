"use strict";
(() => {
  // popup/popup.ts
  var statusIndicator = document.getElementById("status-indicator");
  var statusDot = statusIndicator.querySelector(".status-dot");
  var statusText = statusIndicator.querySelector(".status-text");
  var devicesList = document.getElementById("devices-list");
  var connectLedgerBtn = document.getElementById("connect-ledger");
  var connectTrezorBtn = document.getElementById("connect-trezor");
  var currentDevices = [];
  var supported = { ledger: false, trezor: false };
  async function sendMessage(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error || "Unknown error"));
        }
      });
    });
  }
  function updateStatus(devices) {
    const connectedCount = devices.filter((d) => d.connected).length;
    if (connectedCount > 0) {
      statusDot.classList.add("connected");
      statusDot.classList.remove("disconnected");
      statusText.textContent = `${connectedCount} device${connectedCount > 1 ? "s" : ""} connected`;
    } else {
      statusDot.classList.remove("connected");
      statusDot.classList.add("disconnected");
      statusText.textContent = "No devices connected";
    }
  }
  function renderDevices(devices) {
    if (devices.length === 0) {
      devicesList.innerHTML = '<p class="no-devices">No devices connected</p>';
      return;
    }
    devicesList.innerHTML = devices.map((device) => `
    <div class="device-item">
      <div class="device-info">
        <div class="device-icon ${device.type}">
          ${device.type === "ledger" ? "L" : "T"}
        </div>
        <div class="device-details">
          <span class="device-name">${device.model}</span>
          ${device.fingerprint ? `<span class="device-fingerprint">${device.fingerprint}</span>` : ""}
        </div>
      </div>
      <span class="device-status ${device.connected ? "" : "disconnected"}">
        ${device.connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  `).join("");
  }
  function showError(message) {
    const existingError = document.querySelector(".error-message");
    if (existingError) {
      existingError.remove();
    }
    const errorDiv = document.createElement("div");
    errorDiv.className = "error-message";
    errorDiv.textContent = message;
    const connectSection = document.querySelector(".connect-section");
    if (connectSection) {
      connectSection.appendChild(errorDiv);
      setTimeout(() => {
        errorDiv.remove();
      }, 5e3);
    }
  }
  async function connectDevice(type) {
    const btn = type === "ledger" ? connectLedgerBtn : connectTrezorBtn;
    const originalText = btn.querySelector("span:last-child").textContent;
    try {
      btn.disabled = true;
      btn.querySelector("span:last-child").textContent = "Connecting...";
      const device = await sendMessage("CONNECT_DEVICE", { deviceType: type });
      const existingIndex = currentDevices.findIndex((d) => d.id === device.id);
      if (existingIndex >= 0) {
        currentDevices[existingIndex] = device;
      } else {
        currentDevices.push(device);
      }
      updateStatus(currentDevices);
      renderDevices(currentDevices);
    } catch (error) {
      showError(error.message || `Failed to connect ${type}`);
    } finally {
      btn.disabled = false;
      btn.querySelector("span:last-child").textContent = originalText;
    }
  }
  async function init() {
    try {
      const status = await sendMessage("GET_STATUS");
      supported = status.supported;
      currentDevices = status.devices;
      updateStatus(currentDevices);
      renderDevices(currentDevices);
      connectLedgerBtn.disabled = !supported.ledger;
      connectTrezorBtn.disabled = !supported.trezor;
      if (!supported.ledger) {
        connectLedgerBtn.title = "WebUSB not supported in this browser";
      }
      if (!supported.trezor) {
        connectTrezorBtn.title = "Trezor Connect not supported";
      }
    } catch (error) {
      statusText.textContent = "Extension error";
      showError(error.message || "Failed to initialize");
    }
  }
  connectLedgerBtn.addEventListener("click", () => connectDevice("ledger"));
  connectTrezorBtn.addEventListener("click", () => connectDevice("trezor"));
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DEVICE_UPDATE") {
      currentDevices = message.devices;
      updateStatus(currentDevices);
      renderDevices(currentDevices);
    }
  });
  init();
})();
