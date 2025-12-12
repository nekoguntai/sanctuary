"use strict";
(() => {
  // options/options.ts
  var DEFAULT_SETTINGS = {
    customDomains: [],
    requireHttps: false
  };
  var domainsList = document.getElementById("domains-list");
  var newDomainInput = document.getElementById("new-domain");
  var addDomainBtn = document.getElementById("add-domain-btn");
  var saveBtn = document.getElementById("save-btn");
  var saveStatus = document.getElementById("save-status");
  var requireHttpsCheckbox = document.getElementById("require-https");
  var settings = { ...DEFAULT_SETTINGS };
  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get("settings");
      if (result.settings) {
        settings = { ...DEFAULT_SETTINGS, ...result.settings };
      }
      renderDomains();
      requireHttpsCheckbox.checked = settings.requireHttps;
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }
  async function saveSettings() {
    try {
      await chrome.storage.sync.set({ settings });
      if (settings.customDomains.length > 0) {
        const origins = settings.customDomains.flatMap((domain) => [
          `http://${domain}/*`,
          `http://*.${domain}/*`,
          `https://${domain}/*`,
          `https://*.${domain}/*`
        ]);
        try {
          await chrome.permissions.request({ origins });
        } catch (error) {
          console.warn("Could not request permissions for custom domains:", error);
        }
      }
      showSaveStatus("Settings saved!", false);
    } catch (error) {
      console.error("Failed to save settings:", error);
      showSaveStatus("Failed to save settings", true);
    }
  }
  function showSaveStatus(message, isError) {
    saveStatus.textContent = message;
    saveStatus.className = isError ? "save-status error" : "save-status";
    setTimeout(() => {
      saveStatus.textContent = "";
    }, 3e3);
  }
  function renderDomains() {
    if (settings.customDomains.length === 0) {
      domainsList.innerHTML = '<p class="no-domains">No custom domains added</p>';
      return;
    }
    domainsList.innerHTML = settings.customDomains.map(
      (domain, index) => `
      <div class="domain-item">
        <code>${domain}</code>
        <button data-index="${index}" class="remove-domain">Remove</button>
      </div>
    `
    ).join("");
    domainsList.querySelectorAll(".remove-domain").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const index = parseInt(e.target.dataset.index, 10);
        removeDomain(index);
      });
    });
  }
  function isValidDomain(domain) {
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*)*$/;
    return domainRegex.test(domain);
  }
  function addDomain() {
    const domain = newDomainInput.value.trim().toLowerCase();
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!cleanDomain) {
      showSaveStatus("Please enter a domain", true);
      return;
    }
    if (!isValidDomain(cleanDomain)) {
      showSaveStatus("Invalid domain format", true);
      return;
    }
    if (settings.customDomains.includes(cleanDomain)) {
      showSaveStatus("Domain already added", true);
      return;
    }
    settings.customDomains.push(cleanDomain);
    newDomainInput.value = "";
    renderDomains();
  }
  function removeDomain(index) {
    settings.customDomains.splice(index, 1);
    renderDomains();
  }
  addDomainBtn.addEventListener("click", addDomain);
  newDomainInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      addDomain();
    }
  });
  saveBtn.addEventListener("click", saveSettings);
  requireHttpsCheckbox.addEventListener("change", () => {
    settings.requireHttps = requireHttpsCheckbox.checked;
  });
  loadSettings();
})();
