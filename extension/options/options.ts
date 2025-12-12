// Options page for Sanctuary Hardware Wallet Bridge

interface Settings {
  customDomains: string[];
  requireHttps: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  customDomains: [],
  requireHttps: false,
};

// DOM elements
const domainsList = document.getElementById('domains-list')!;
const newDomainInput = document.getElementById('new-domain') as HTMLInputElement;
const addDomainBtn = document.getElementById('add-domain-btn')!;
const saveBtn = document.getElementById('save-btn')!;
const saveStatus = document.getElementById('save-status')!;
const requireHttpsCheckbox = document.getElementById('require-https') as HTMLInputElement;

// Current settings
let settings: Settings = { ...DEFAULT_SETTINGS };

// Load settings from storage
async function loadSettings(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get('settings');
    if (result.settings) {
      settings = { ...DEFAULT_SETTINGS, ...result.settings };
    }
    renderDomains();
    requireHttpsCheckbox.checked = settings.requireHttps;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Save settings to storage
async function saveSettings(): Promise<void> {
  try {
    await chrome.storage.sync.set({ settings });

    // Request permission for custom domains
    if (settings.customDomains.length > 0) {
      const origins = settings.customDomains.flatMap(domain => [
        `http://${domain}/*`,
        `http://*.${domain}/*`,
        `https://${domain}/*`,
        `https://*.${domain}/*`,
      ]);

      try {
        await chrome.permissions.request({ origins });
      } catch (error) {
        console.warn('Could not request permissions for custom domains:', error);
      }
    }

    showSaveStatus('Settings saved!', false);
  } catch (error) {
    console.error('Failed to save settings:', error);
    showSaveStatus('Failed to save settings', true);
  }
}

// Show save status message
function showSaveStatus(message: string, isError: boolean): void {
  saveStatus.textContent = message;
  saveStatus.className = isError ? 'save-status error' : 'save-status';

  setTimeout(() => {
    saveStatus.textContent = '';
  }, 3000);
}

// Render the custom domains list
function renderDomains(): void {
  if (settings.customDomains.length === 0) {
    domainsList.innerHTML = '<p class="no-domains">No custom domains added</p>';
    return;
  }

  domainsList.innerHTML = settings.customDomains
    .map(
      (domain, index) => `
      <div class="domain-item">
        <code>${domain}</code>
        <button data-index="${index}" class="remove-domain">Remove</button>
      </div>
    `
    )
    .join('');

  // Add event listeners to remove buttons
  domainsList.querySelectorAll('.remove-domain').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const index = parseInt((e.target as HTMLElement).dataset.index!, 10);
      removeDomain(index);
    });
  });
}

// Validate domain format
function isValidDomain(domain: string): boolean {
  // Basic domain validation
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*)*$/;
  return domainRegex.test(domain);
}

// Add a new custom domain
function addDomain(): void {
  const domain = newDomainInput.value.trim().toLowerCase();

  // Remove protocol if present
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  if (!cleanDomain) {
    showSaveStatus('Please enter a domain', true);
    return;
  }

  if (!isValidDomain(cleanDomain)) {
    showSaveStatus('Invalid domain format', true);
    return;
  }

  if (settings.customDomains.includes(cleanDomain)) {
    showSaveStatus('Domain already added', true);
    return;
  }

  settings.customDomains.push(cleanDomain);
  newDomainInput.value = '';
  renderDomains();
}

// Remove a custom domain
function removeDomain(index: number): void {
  settings.customDomains.splice(index, 1);
  renderDomains();
}

// Event listeners
addDomainBtn.addEventListener('click', addDomain);

newDomainInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addDomain();
  }
});

saveBtn.addEventListener('click', saveSettings);

requireHttpsCheckbox.addEventListener('change', () => {
  settings.requireHttps = requireHttpsCheckbox.checked;
});

// Initialize
loadSettings();
