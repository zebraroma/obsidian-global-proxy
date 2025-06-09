var import_obsidian = require("obsidian");
var electron = require('electron');

const DEFAULT_SETTINGS = {
    enableProxy: false,
    httpProxy: "",
	httpsProxy: "",
	socksProxy: "",
	bypassRules: "<local>,127.*,10.*,172.16.*,172.17.*,172.18.*,172.19.*,172.20.*,172.21.*,172.22.*,172.23.*,172.24.*,172.25.*,172.26.*,172.27.*,172.28.*,172.29.*,172.30.*,172.31.*,192.168.*",
	pluginTokens: "persist:surfing-vault-${appId}"
};

var GlobalProxyPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new GlobalProxySettingTab(this.app, this));
    
    this.addCommand({
      id: 'toggle-global-proxy',
      name: 'Toggle global proxy',
      callback: async () => {
        this.settings.enableProxy = !this.settings.enableProxy;
        await this.saveSettings();
        this.settings.enableProxy ? this.enableProxy() : this.disableProxy();
        this.updateStatusBar();
      }
    });

    this.addCommand({
      id: 'enable-global-proxy',
      name: 'Enable global proxy',
      callback: async () => {
        if (!this.settings.enableProxy) {
          this.settings.enableProxy = true;
          await this.saveSettings();
          this.enableProxy();
          this.updateStatusBar();
        }
      }
    });

    this.addCommand({
      id: 'disable-global-proxy',
      name: 'Disable global proxy',
      callback: async () => {
        if (this.settings.enableProxy) {
          this.settings.enableProxy = false;
          await this.saveSettings();
          this.disableProxy();
          this.updateStatusBar();
        }
      }
    });

    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass('proxy-status');
    
    this.registerDomEvent(this.statusBarItem, 'click', (event) => {
      if (event.button === 0) {
        this.showStatusBarMenu(event);
      } else {
        this.toggleProxy();
      }
    });
    
    this.updateStatusBar();
  }
  
  showStatusBarMenu(event) {
    const menu = new import_obsidian.Menu(this.app);
    
    menu.addItem((item) => {
      if (this.settings.enableProxy) {
        item.setTitle("Disable proxy")
          .setIcon("toggle-off")
          .onClick(async () => {
            this.settings.enableProxy = false;
            await this.saveSettings();
            this.disableProxy();
            this.updateStatusBar();
          });
      } else {
        item.setTitle("Enable proxy")
          .setIcon("toggle-on")
          .onClick(async () => {
            this.settings.enableProxy = true;
            await this.saveSettings();
            this.enableProxy();
            this.updateStatusBar();
          });
      }
    });
    
    menu.addSeparator();
    
    menu.addItem((item) => {
      item.setTitle("Global Proxy Settings")
        .setIcon("settings")
        .onClick(() => {
          this.app.setting.open();
          this.app.setting.openTabById('global-proxy');
        });
    });
    
    menu.showAtPosition({x: event.clientX, y: event.clientY});
  }
  
  async toggleProxy() {
    this.settings.enableProxy = !this.settings.enableProxy;
    await this.saveSettings();
    this.settings.enableProxy ? this.enableProxy() : this.disableProxy();
    this.updateStatusBar();
  }
  
  updateStatusBar() {
    if (!this.statusBarItem) return;
    
    if (this.settings.enableProxy) {
      this.statusBarItem.setText('🌐 Proxy: ON');
      this.statusBarItem.addClass('proxy-enabled');
      this.statusBarItem.removeClass('proxy-disabled');
    } else {
      this.statusBarItem.setText('🌐 Proxy: OFF');
      this.statusBarItem.addClass('proxy-disabled');
      this.statusBarItem.removeClass('proxy-enabled');
    }
  }
  
  async onunload() {
    this.disableProxy();
    if (this.statusBarItem) {
      this.statusBarItem.remove();
    }
  }
  
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	this.sessionMap = {}
	this.enableProxy();
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  
  async enableProxy() {
		if (!this.settings.enableProxy) {
			return;
		}
	  
		let sessions = []
		this.sessionMap.default = electron.remote.session.defaultSession
		sessions.push(this.sessionMap.default)
		  
		if (!!this.settings.pluginTokens) {
			let pluginTokens = this.settings.pluginTokens.split("\n");
			for (var i = 0; i < pluginTokens.length; i++) {
				if (!pluginTokens[i]) {
					continue;
				}
				let token = pluginTokens[i].replace("${appId}", this.app.appId)
				let session = await electron.remote.session.fromPartition(token)
				sessions.push(session)
				this.sessionMap[token] = session
			}
		}

		let proxyRules = this.composeProxyRules(), 
			proxyBypassRules = proxyRules ? this.settings.bypassRules : undefined;

		for (var i = 0; i < sessions.length; i++) {
			await sessions[i].setProxy({ proxyRules, proxyBypassRules }); 
		}

		if (proxyRules) {
			new import_obsidian.Notice('Enable proxy!');
		}
    
    this.updateStatusBar();
	}
	
	
	async disableProxy() {
		let sessions = []
		for (const key in this.sessionMap) {
			sessions.push(this.sessionMap[key])
		}
				
		for (var i = 0; i < sessions.length; i++) {
			await sessions[i].setProxy({});
			await sessions[i].closeAllConnections();
		}
		new import_obsidian.Notice('Disable proxy!');
    
    this.updateStatusBar();
	}
	
	
	composeProxyRules() {
		if (!["socksProxy", "httpProxy", "httpsProxy"].
			map((p) => !this.settings[p] || isValidFormat(this.settings[p])).reduce((res, check)=>{return res && check}, true)) {
			return undefined;
		}
		
		
		const httpProxy= isValidFormat(this.settings.httpProxy) ? ";http=" + this.settings.httpProxy : "";
		const httpsProxy= isValidFormat(this.settings.httpsProxy) ? ";https=" + this.settings.httpsProxy : "";
		if (isValidFormat(this.settings.socksProxy)) {
			return this.settings.socksProxy + httpProxy + httpsProxy + ",direct://"
		} else if (!!httpProxy) {
			return !!httpsProxy ? "http=" + this.settings.httpProxy + httpsProxy + ",direct://"
				: this.settings.httpProxy + ",direct://"
		} else if (!!httpsProxy) {
			return this.settings.httpsProxy + ",direct://"
		}
		
		return undefined;
	}

	async testProxy(proxyType) {
		// Return a promise for further processing of results
		return new Promise(async (resolve, reject) => {
			const timeout = 15000; // 15 seconds timeout
			// Use API service that returns information about the current IP
			const testUrl = 'https://api.ipify.org?format=json'; 
			let testSession = null;
			let directSession = null;
			let proxyRules = '';

			// Check validity and availability of proxy address
			if (!this.settings[proxyType] || !isValidFormat(this.settings[proxyType])) {
				return reject(new Error("Invalid proxy address format"));
			}

			try {
				// First check our direct IP address (without proxy)
				directSession = electron.remote.session.fromPartition('direct-test-' + Date.now().toString());
				
				// Get information about our real IP
				let directIp = null;
				try {
					directIp = await this.makeRequestAndGetIp(directSession, testUrl, timeout);
					console.log("Direct connection, IP:", directIp);
				} catch (error) {
					// If we couldn't get direct IP, we can't continue checking
					this.cleanupSessions(directSession, null);
					return reject(new Error("Failed to determine your direct IP: " + error.message));
				}

				// Create a test session for proxy
				testSession = electron.remote.session.fromPartition('proxy-test-' + Date.now().toString());
				
				// Configure proxy rules depending on the type
				if (proxyType === 'socksProxy') {
					proxyRules = this.settings.socksProxy + ',direct://';
				} else if (proxyType === 'httpProxy') {
					proxyRules = 'http=' + this.settings.httpProxy + ',direct://';
				} else if (proxyType === 'httpsProxy') {
					proxyRules = 'https=' + this.settings.httpsProxy + ',direct://';
				}

				// Set proxy for the test session
				await testSession.setProxy({ proxyRules });

				try {
					// Now check IP through proxy
					const proxyIp = await this.makeRequestAndGetIp(testSession, testUrl, timeout);
					console.log("Proxy connection, IP:", proxyIp);
					
					// Close sessions
					this.cleanupSessions(directSession, testSession);
					
					// Compare IP addresses
					if (proxyIp && proxyIp !== directIp) {
						resolve({
							success: true,
							directIp: directIp,
							proxyIp: proxyIp,
							message: `Proxy is working. Your IP changed from ${directIp} to ${proxyIp}`
						});
					} else {
						reject(new Error(`Proxy is not working. IP has not changed (${directIp})`));
					}
				} catch (error) {
					// Close sessions
					this.cleanupSessions(directSession, testSession);
					
					reject(new Error(`Error checking proxy: ${error.message}`));
				}
			} catch (error) {
				// In case of unexpected error, close sessions
				this.cleanupSessions(directSession, testSession);
				
				reject(error);
			}
		});
	}

	// Helper method for cleanup sessions
	cleanupSessions(directSession, testSession) {
		if (directSession) {
			try {
				directSession.closeAllConnections();
			} catch (e) {
				console.error("Error closing direct session:", e);
			}
		}
		
		if (testSession) {
			try {
				testSession.closeAllConnections();
			} catch (e) {
				console.error("Error closing proxy session:", e);
			}
		}
	}

	// Helper method for making request and getting IP
	async makeRequestAndGetIp(session, url, timeout) {
		return new Promise((resolve, reject) => {
			let isResolved = false;
			let timeoutId = null;
			
			// Set timeout
			timeoutId = setTimeout(() => {
				if (!isResolved) {
					isResolved = true;
					reject(new Error("Request timed out (15 seconds). No response from server."));
				}
			}, timeout);
			
			const request = electron.remote.net.request({
				method: 'GET',
				url: url,
				session: session
			});
			
			let responseData = '';
			
			request.on('response', (response) => {
				if (response.statusCode !== 200) {
					if (!isResolved) {
						isResolved = true;
						clearTimeout(timeoutId);
						reject(new Error(`HTTP error: ${response.statusCode}`));
					}
					return;
				}
				
				response.on('data', (chunk) => {
					responseData += chunk.toString();
				});
				
				response.on('end', () => {
					if (!isResolved) {
						isResolved = true;
						clearTimeout(timeoutId);
						try {
							const data = JSON.parse(responseData);
							if (data && data.ip) {
								resolve(data.ip);
							} else {
								reject(new Error("Failed to get IP from response"));
							}
						} catch (error) {
							reject(new Error("Error processing response: " + error.message));
						}
					}
				});
				
				response.on('error', (error) => {
					if (!isResolved) {
						isResolved = true;
						clearTimeout(timeoutId);
						reject(error);
					}
				});
			});
			
			request.on('error', (error) => {
				if (!isResolved) {
					isResolved = true;
					clearTimeout(timeoutId);
					reject(error);
				}
			});
			
			// Set additional handler for request abort
			request.on('abort', () => {
				if (!isResolved) {
					isResolved = true;
					clearTimeout(timeoutId);
					reject(new Error("Request was aborted"));
				}
			});
			
			request.end();
		});
	}
};

var GlobalProxySettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.proxyStatusElements = {};
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();

    // Styles for status indicators
    const style = document.createElement('style');
    style.textContent = `
      .proxy-status-container {
        display: flex;
        align-items: center;
        margin-top: 8px;
      }
      .proxy-status-indicator {
        display: inline-block;
        min-width: 15px;
        height: 15px;
        border-radius: 50%;
        margin-right: 10px;
        flex-shrink: 0;
      }
      .proxy-status-checking {
        background-color: #888;
      }
      .proxy-status-success {
        background-color: #4CAF50;
      }
      .proxy-status-error {
        background-color: #F44336;
      }
      .proxy-check-button {
        margin-left: 5px;
      }
      .proxy-status-message {
        font-size: 12px;
        color: #888;
        word-break: break-word;
        margin-left: 0;
        flex-grow: 1;
      }
      .proxy-error-message {
        color: #F44336;
      }
      .proxy-timeout-message {
        color: #FF9800;
        font-weight: bold;
      }
      .proxy-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 4px;
        font-size: 12px;
      }
      .proxy-ip-info {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .proxy-ip-label {
        font-weight: bold;
        min-width: 80px;
      }
      .proxy-success-details {
        margin-top: 4px;
        padding: 6px 10px;
        background-color: rgba(76, 175, 80, 0.1);
        border-radius: 4px;
        border-left: 3px solid #4CAF50;
      }
    `;
    containerEl.appendChild(style);

	new import_obsidian.Setting(containerEl)
	.setName("Enable proxy")
	.setDesc("Change your proxy status")
	.addToggle((val) => val
	.setValue(this.plugin.settings.enableProxy)
	.onChange(async (value) =>  {
		this.plugin.settings.enableProxy = value;
		await this.plugin.saveSettings();
		value ? this.plugin.enableProxy() : this.plugin.disableProxy();
    }));

    this.createProxySettingWithCheck(containerEl, "Socks Proxy", "socksProxy", "<scheme>://<host>:<port>");
    this.createProxySettingWithCheck(containerEl, "Http Proxy", "httpProxy", "<scheme>://<host>:<port>");
    this.createProxySettingWithCheck(containerEl, "Https Proxy", "httpsProxy", "<scheme>://<host>:<port>");

	new import_obsidian.Setting(containerEl)
	.setName("Plugin Tokens")
	.setDesc("For proxy specified plugins")
	.addTextArea((text) => text
	.setValue(this.plugin.settings.pluginTokens)
	.onChange((value) => {
	  this.refreshProxy("pluginTokens", value);  
    }));
	new import_obsidian.Setting(containerEl)
	.setName("Blacklist")
	.setDesc("Proxy blacklist")
	.addTextArea((text) => text
	.setPlaceholder("[URL_SCHEME://] HOSTNAME_PATTERN [:<port>]\n. HOSTNAME_SUFFIX_PATTERN [:PORT]\n[SCHEME://] IP_LITERAL [:PORT]\nIP_LITERAL / PREFIX_LENGTH_IN_BITS\n<local>")
	.setValue(this.plugin.settings.bypassRules)
	.onChange((value) => {
	  this.refreshProxy("bypassRules", value);      
    }));
  }

  createProxySettingWithCheck(containerEl, name, settingKey, placeholder) {
    const setting = new import_obsidian.Setting(containerEl)
      .setName(name)
      .setDesc(`Set up your ${name.toLowerCase()}`);

    // Add input field
    setting.addText((text) => text
      .setPlaceholder(placeholder)
      .setValue(this.plugin.settings[settingKey])
      .onChange((value) => {
        this.refreshProxy(settingKey, value);
        // Reset status indicator when address changes
        this.resetProxyStatusIndicator(settingKey);
      }));

    // Add check button
    setting.addButton((button) => button
      .setButtonText("Check")
      .setClass("proxy-check-button")
      .onClick(() => this.checkProxy(settingKey)));

    // Add status indicator and message
    const statusContainer = containerEl.createDiv();
    statusContainer.addClass("proxy-status-container");
    
    const statusIndicator = statusContainer.createDiv();
    statusIndicator.addClass("proxy-status-indicator");
    
    const statusMessage = statusContainer.createDiv();
    statusMessage.addClass("proxy-status-message");
    
    // Create container for additional information
    const infoContainer = containerEl.createDiv();
    infoContainer.addClass("proxy-info");
    infoContainer.style.display = 'none';
    
    setting.settingEl.appendChild(statusContainer);
    setting.settingEl.appendChild(infoContainer);

    // Save references to status elements
    this.proxyStatusElements[settingKey] = {
      indicator: statusIndicator,
      message: statusMessage,
      infoContainer: infoContainer
    };
  }

  // Check proxy
  async checkProxy(proxyType) {
    const statusElements = this.proxyStatusElements[proxyType];
    
    if (!this.plugin.settings[proxyType] || !isValidFormat(this.plugin.settings[proxyType])) {
      this.updateProxyStatus(proxyType, 'error', 'Invalid address format', 'error');
      return;
    }

    try {
      // Update indicator to "checking" state
      this.updateProxyStatus(proxyType, 'checking', 'Checking...');
      
      // Clear information container
      if (statusElements.infoContainer) {
        statusElements.infoContainer.empty();
        statusElements.infoContainer.style.display = 'none';
      }
      
      // Call proxy check function
      const result = await this.plugin.testProxy(proxyType);
      
      // Update indicator to "success" state with IP information
      this.updateProxyStatus(
        proxyType, 
        'success', 
        'Proxy is working successfully'
      );
      
      // Display detailed information about results
      if (statusElements.infoContainer) {
        const infoContainer = statusElements.infoContainer;
        infoContainer.style.display = 'flex';
        
        const successDetails = infoContainer.createDiv();
        successDetails.addClass('proxy-success-details');
        
        // Information about direct IP
        const directIpContainer = successDetails.createDiv();
        directIpContainer.addClass('proxy-ip-info');
        
        const directIpLabel = directIpContainer.createDiv();
        directIpLabel.addClass('proxy-ip-label');
        directIpLabel.setText('Direct IP:');
        
        const directIpValue = directIpContainer.createDiv();
        directIpValue.setText(result.directIp);
        
        // Information about proxy IP
        const proxyIpContainer = successDetails.createDiv();
        proxyIpContainer.addClass('proxy-ip-info');
        
        const proxyIpLabel = proxyIpContainer.createDiv();
        proxyIpLabel.addClass('proxy-ip-label');
        proxyIpLabel.setText('Proxy IP:');
        
        const proxyIpValue = proxyIpContainer.createDiv();
        proxyIpValue.setText(result.proxyIp);
      }
    } catch (error) {
      // Determine error type based on message
      let errorType = 'error';
      if (error.message.includes('timed out') || error.message.includes('timeout')) {
        errorType = 'timeout';
      }
      
      // Update indicator to "error" state with error type
      this.updateProxyStatus(proxyType, 'error', `Error: ${error.message}`, errorType);
      
      // Hide information container
      if (statusElements.infoContainer) {
        statusElements.infoContainer.empty();
        statusElements.infoContainer.style.display = 'none';
      }
    }
  }

  // Update proxy status
  updateProxyStatus(proxyType, status, message, errorType = null) {
    const statusElements = this.proxyStatusElements[proxyType];
    if (!statusElements) return;

    const { indicator, message: messageEl } = statusElements;
    
    // Remove all status classes
    indicator.removeClass("proxy-status-checking", "proxy-status-success", "proxy-status-error");
    
    // Add new status class
    indicator.addClass(`proxy-status-${status}`);
    
    // Update message and its style
    messageEl.setText(message);
    
    // Reset error message classes
    messageEl.removeClass("proxy-error-message", "proxy-timeout-message");
    
    // Add special class for errors or timeouts
    if (errorType === 'error') {
      messageEl.addClass("proxy-error-message");
    } else if (errorType === 'timeout') {
      messageEl.addClass("proxy-timeout-message");
    }
  }

  // Reset status indicator
  resetProxyStatusIndicator(proxyType) {
    const statusElements = this.proxyStatusElements[proxyType];
    if (!statusElements) return;

    const { indicator, message: messageEl, infoContainer } = statusElements;
    
    // Remove all status classes
    indicator.removeClass("proxy-status-checking", "proxy-status-success", "proxy-status-error");
    
    // Reset message
    messageEl.setText('');
    
    // Hide information container
    if (infoContainer) {
      infoContainer.empty();
      infoContainer.style.display = 'none';
    }
  }

  async refreshProxy(key, value) {
	  this.plugin.settings[key] = value;
	  this.plugin.saveSettings();
	  
	  this.plugin.enableProxy(); 
  }
};


function isValidFormat(proxyUrl) {
  if (!!proxyUrl) {
	  const regex = /^(\w+):\/\/([^:/]+):(\d+)$/;
	  const matches = proxyUrl.match(regex);
	  return !!matches;
  }
  return false;
}

module.exports = GlobalProxyPlugin;
