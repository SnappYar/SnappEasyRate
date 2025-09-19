(() => {
    /**
     * Keys used in chrome.storage
     */
    const STORAGE_KEYS = {
        apiUrl: 'sms_api_url',
        authToken: 'sms_auth_token',
        logs: 'sms_logs',
        sfToken: 'sf_token',
        sfTokenExpiry: 'sf_token_expiry',
        sfVendors: 'sf_vendors',
        smsTemplate: 'sms_template'
    };

    /**
     * Append a message to the log textarea and persist a rolling log
     */
    function appendLog(message) {
        const timestamp = new Date().toLocaleString();
        const line = `[${timestamp}] ${message}`;
        const output = document.getElementById('logOutput');
        if (output) {
            output.value = (output.value ? output.value + '\n' : '') + line;
            output.scrollTop = output.scrollHeight;
        }
        chrome.storage.sync.get([STORAGE_KEYS.logs], (data) => {
            const current = Array.isArray(data[STORAGE_KEYS.logs]) ? data[STORAGE_KEYS.logs] : [];
            current.push(line);
            // keep last 200 lines
            const trimmed = current.slice(-200);
            chrome.storage.sync.set({ [STORAGE_KEYS.logs]: trimmed });
        });
    }

    function setGatedEnabled(enabled) {
        const phoneInput = document.getElementById('phoneNumber');
        const msgInput = document.getElementById('message');
        const sendBtn = document.getElementById('sendBtn');
        const hint = document.getElementById('gateHint');
        [phoneInput, msgInput, sendBtn].forEach((el) => {
            if (el) el.disabled = !enabled;
        });
        if (hint) hint.style.display = enabled ? 'none' : 'block';
    }

    function loadSettings(callback) {
        chrome.storage.sync.get([STORAGE_KEYS.apiUrl, STORAGE_KEYS.authToken], (data) => {
            const apiUrl = data[STORAGE_KEYS.apiUrl] || '';
            const authToken = data[STORAGE_KEYS.authToken] || '';
            callback({ apiUrl, authToken });
        });
    }

    function saveSettings({ apiUrl, authToken }, onDone) {
        chrome.storage.sync.set({
            [STORAGE_KEYS.apiUrl]: apiUrl || '',
            [STORAGE_KEYS.authToken]: authToken || ''
        }, onDone);
    }

    async function sendSms({ apiUrl, authToken, phoneNumber, message }) {
        if (!apiUrl || !authToken) {
            throw new Error('API URL یا توکن تنظیم نشده است');
        }
        appendLog(`ارسال پیام به ${phoneNumber}...`);
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ProviderId: 1,
                Number: phoneNumber,
                Message: message
            })
        });

        // Chrome fetch Response doesn't have statusCode, use status
        if (res.status >= 300) {
            const text = await safeReadBody(res);
            throw new Error(`خطا در ارسال (${res.status}): ${text}`);
        }
        const text = await safeReadBody(res);
        return text;
    }

    async function safeReadBody(res) {
        try {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                const j = await res.json();
                return JSON.stringify(j);
            }
            return await res.text();
        } catch (_) {
            return '';
        }
    }

    function setSnappfoodControlsEnabled(enabled) {
        const methodRadios = document.querySelectorAll('input[name="sfLoginMethod"]');
        methodRadios.forEach(r => r.disabled = !enabled);
        const pwdInputs = [
            document.getElementById('sfCellphonePwd'),
            document.getElementById('sfPassword'),
            document.getElementById('sfPasswordLoginBtn')
        ];
        pwdInputs.forEach(el => { if (el) el.disabled = !enabled; });
        const otpInputs = [
            document.getElementById('sfCellphoneOtp'),
            document.getElementById('sfSendOtpBtn'),
            document.getElementById('sfOtpCode'),
            document.getElementById('sfVerifyOtpBtn')
        ];
        otpInputs.forEach(el => { if (el) el.disabled = !enabled; });
    }

    function setSnappfoodStatusUI({ token, expiry }) {
        const statusEl = document.getElementById('sfTokenStatus');
        const logoutBtn = document.getElementById('sfLogoutBtn');
        if (!statusEl || !logoutBtn) return;
        const now = Date.now();
        const valid = Boolean(token && expiry && now < expiry);
        if (valid) {
            const remainingMs = expiry - now;
            const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
            statusEl.textContent = `وضعیت : وارد شده (انقضا تا ${remainingDays} روز دیگر)`;
            logoutBtn.style.display = 'inline-block';
            // Disable login controls when logged in
            setSnappfoodControlsEnabled(false);
            // Stop any running OTP timer
            if (typeof window !== 'undefined' && window.__sfOtpTimerStop) {
                try { window.__sfOtpTimerStop(); } catch (_) { }
            }
        } else {
            statusEl.textContent = 'وضعیت : خارج شده';
            logoutBtn.style.display = 'none';
            // Enable login controls when logged out
            setSnappfoodControlsEnabled(true);
        }
    }

    function saveSnappfoodToken(token) {
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const expiry = Date.now() + sevenDaysMs;
        chrome.storage.sync.set({
            [STORAGE_KEYS.sfToken]: token || '',
            [STORAGE_KEYS.sfTokenExpiry]: expiry
        }, () => {
            setSnappfoodStatusUI({ token, expiry });
            appendLog('توکن اسنپفود ذخیره شد');
        });
    }

    function loadSnappfoodToken(cb) {
        chrome.storage.sync.get([STORAGE_KEYS.sfToken, STORAGE_KEYS.sfTokenExpiry], (data) => {
            const token = data[STORAGE_KEYS.sfToken] || '';
            const expiry = data[STORAGE_KEYS.sfTokenExpiry] || 0;
            cb({ token, expiry });
        });
    }

    function loadSnappfoodVendors(cb) {
        chrome.storage.sync.get([STORAGE_KEYS.sfVendors], (data) => {
            const vendors = Array.isArray(data[STORAGE_KEYS.sfVendors]) ? data[STORAGE_KEYS.sfVendors] : [];
            cb(vendors);
        });
    }

    function saveSnappfoodVendors(vendors) {
        chrome.storage.sync.set({ [STORAGE_KEYS.sfVendors]: vendors || [] }, () => {
            appendLog(`لیست وندورها ذخیره شد (${Array.isArray(vendors) ? vendors.length : 0})`);
        });
    }

    function normalizeSnappfoodToken(raw) {
        if (!raw) return '';
        try {
            const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const candidate = obj?.data?.vendor?.accessToken
                || obj?.vendor?.accessToken
                || obj?.data?.order?.accessToken
                || obj?.order?.accessToken
                || obj?.accessToken
                || obj?.data?.access_token
                || obj?.access_token;
            // appendLog(`توکن اسنپفود: ${candidate}`);
            return typeof candidate === 'string' ? candidate : '';
        } catch (_) {
            return '';
        }
    }

    async function fetchSnappfoodVendors({ token }) {
        const bearer = normalizeSnappfoodToken(token);
        if (!bearer) throw new Error('توکن اسنپ\fفود موجود نیست یا معتبر نیست');
        const res = await fetch('https://vendor.snappfood.ir/vms/v2/user/vendors', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${bearer}`,
                'Accept': 'application/json'
            }
        });
        const text = await safeReadBody(res);
        if (res.status >= 300) {
            throw new Error(`دریافت وندورها ناموفق (${res.status}): ${text}`);
        }
        let json;
        try { json = JSON.parse(text || '{}'); } catch (_) { json = null; }
        // Prefer JSON:API shape with included vendorUser entries
        let items = [];
        if (Array.isArray(json?.included)) {
            items = json.included.filter(e => e && e.type === 'vendorUser');
        }
        // Fallbacks: plain array or data array
        if (!items.length) {
            if (Array.isArray(json)) items = json;
            else if (Array.isArray(json?.data)) items = json.data;
        }
        const mapped = items.map((item) => {
            const id = item?.id || item?.attributes?.id;
            const title = item?.attributes?.title || item?.title || '';
            return { id: String(id || ''), title: String(title || '') };
        }).filter(v => v.id && v.title);
        return mapped;
    }

    async function sfLoginWithPassword({ cellphone, password }) {
        const body = {
            data: {
                scopes: ["vmo", "vms"],
                client_id: "snappfood_vms",
                client_secret: "snappfood_vms_secret"
            },
            grantType: "Password",
            cellphone,
            password
        };
        const res = await fetch('https://user.snappfood.ir/v1/auth/vendor/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const text = await safeReadBody(res);
        if (res.status >= 300) {
            throw new Error(`خطا ورود (${res.status}): ${text}`);
        }
        try {
            const json = JSON.parse(text || '{}');
            const vendor = json?.data?.vendor || json?.vendor;
            const token = vendor?.accessToken || json?.data?.access_token || json?.access_token || text;
            const expiresSec = vendor?.accessTokenExpiresAt;
            const expiryMs = typeof expiresSec === 'number' ? expiresSec * 1000 : undefined;
            return { token, expiryMs };
        } catch (_) {
            return { token: text, expiryMs: undefined };
        }
    }

    async function sfSendOtp({ mobile_number }) {
        const res = await fetch('https://user.snappfood.ir/v1/auth/otp/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile_number })
        });
        const text = await safeReadBody(res);
        if (res.status >= 300) {
            throw new Error(`ارسال کد ناموفق (${res.status}): ${text}`);
        }
        return text;
    }

    async function sfVerifyOtp({ cellphone, otpCode }) {
        const body = {
            data: {
                scopes: ["vmo", "vms"],
                client_id: "snappfood_vms",
                client_secret: "snappfood_vms_secret"
            },
            grantType: "Otp",
            cellphone,
            otpCode,
        };
        const res = await fetch('https://user.snappfood.ir/v1/auth/vendor/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body)
        });
        const text = await safeReadBody(res);
        if (res.status >= 300) {
            throw new Error(`تایید کد ناموفق (${res.status}): ${text}`);
        }
        try {
            const json = JSON.parse(text || '{}');
            const vendor = json?.data?.vendor || json?.vendor;
            const token = vendor?.accessToken || json?.data?.access_token || json?.access_token || text;
            const expiresSec = vendor?.accessTokenExpiresAt;
            const expiryMs = typeof expiresSec === 'number' ? expiresSec * 1000 : undefined;
            return { token, expiryMs };
        } catch (_) {
            return { token: text, expiryMs: undefined };
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const apiUrlInput = document.getElementById('apiUrl');
        const authTokenInput = document.getElementById('authToken');
        const saveSettingsBtn = document.getElementById('saveSettingsBtn');
        const saveStatus = document.getElementById('saveStatus');
        const phoneInput = document.getElementById('phoneNumber');
        const msgInput = document.getElementById('message');
        const sendBtn = document.getElementById('sendBtn');
        const clearLogBtn = document.getElementById('clearLogBtn');
        const smsTemplateInput = document.getElementById('smsTemplate');
        const saveTemplateBtn = document.getElementById('saveTemplateBtn');

        // Load logs
        chrome.storage.sync.get([STORAGE_KEYS.logs], (data) => {
            const output = document.getElementById('logOutput');
            const lines = Array.isArray(data[STORAGE_KEYS.logs]) ? data[STORAGE_KEYS.logs] : [];
            if (output && lines.length) {
                output.value = lines.join('\n');
                output.scrollTop = output.scrollHeight;
            }
        });

        // Load settings and gate test section
        loadSettings(({ apiUrl, authToken }) => {
            if (apiUrlInput) apiUrlInput.value = apiUrl;
            if (authTokenInput) authTokenInput.value = authToken;
            const enabled = Boolean(apiUrl && authToken);
            setGatedEnabled(enabled);
        });

        // Load SMS template
        chrome.storage.sync.get([STORAGE_KEYS.smsTemplate], (data) => {
            if (smsTemplateInput) smsTemplateInput.value = data[STORAGE_KEYS.smsTemplate] || '';
        });

        // Save settings
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => {
                const apiUrl = apiUrlInput.value.trim();
                const authToken = authTokenInput.value.trim();
                saveSettings({ apiUrl, authToken }, () => {
                    if (saveStatus) {
                        saveStatus.textContent = 'ذخیره شد!';
                        setTimeout(() => (saveStatus.textContent = ''), 1500);
                    }
                    setGatedEnabled(Boolean(apiUrl && authToken));
                    appendLog('تنظیمات ذخیره شد');
                });
            });
        }

        // Send SMS
        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                const phoneNumber = phoneInput.value.trim();
                const message = msgInput.value.trim();
                if (!phoneNumber || !message) {
                    appendLog('شماره یا متن پیام وارد نشده است');
                    return;
                }
                loadSettings(async ({ apiUrl, authToken }) => {
                    try {
                        const result = await sendSms({ apiUrl, authToken, phoneNumber, message });
                        appendLog(`ارسال موفق: ${result || 'OK'}`);
                    } catch (err) {
                        appendLog(String(err && err.message ? err.message : err));
                    }
                });
            });
        }

        // Save SMS template
        if (saveTemplateBtn) {
            saveTemplateBtn.addEventListener('click', () => {
                const tpl = (smsTemplateInput && smsTemplateInput.value) ? smsTemplateInput.value : '';
                chrome.storage.sync.set({ [STORAGE_KEYS.smsTemplate]: tpl }, () => {
                    appendLog('متن پیش‌فرض پیامک ذخیره شد');
                });
            });
        }

        // Clear logs
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', () => {
                chrome.storage.sync.set({ [STORAGE_KEYS.logs]: [] }, () => {
                    const output = document.getElementById('logOutput');
                    if (output) output.value = '';
                });
            });
        }

        // Snappfood UI handlers
        const methodRadios = document.querySelectorAll('input[name="sfLoginMethod"]');
        const pwdForm = document.getElementById('sfPasswordForm');
        const otpForm = document.getElementById('sfOtpForm');
        const otpStep = document.getElementById('sfOtpStep');
        const sendOtpBtn = document.getElementById('sfSendOtpBtn');
        const verifyOtpBtn = document.getElementById('sfVerifyOtpBtn');
        const pwdLoginBtn = document.getElementById('sfPasswordLoginBtn');
        const logoutBtn = document.getElementById('sfLogoutBtn');
        const otpTimerEl = document.getElementById('sfOtpTimer');

        let otpTimerId = null;
        let otpExpiresAt = 0;

        // expose a stopper to cancel timer when logging in
        window.__sfOtpTimerStop = function () {
            if (otpTimerId) {
                clearInterval(otpTimerId);
                otpTimerId = null;
            }
        };

        function updateOtpTimer() {
            if (!otpTimerEl) return;
            const remaining = Math.max(0, otpExpiresAt - Date.now());
            const sec = Math.ceil(remaining / 1000);
            otpTimerEl.textContent = remaining > 0 ? `(مهلت: ${sec} ثانیه)` : '(ارسال مجدد کد)';
            if (remaining <= 0) {
                if (verifyOtpBtn) verifyOtpBtn.disabled = true;
                if (sendOtpBtn) sendOtpBtn.disabled = false;
                clearInterval(otpTimerId);
                otpTimerId = null;
            } else {
                if (sendOtpBtn) sendOtpBtn.disabled = true;
            }
        }

        methodRadios.forEach((r) => {
            r.addEventListener('change', () => {
                const value = document.querySelector('input[name="sfLoginMethod"]:checked').value;
                if (value === 'password') {
                    pwdForm.style.display = '';
                    otpForm.style.display = 'none';
                } else {
                    pwdForm.style.display = 'none';
                    otpForm.style.display = '';
                    // Respect countdown state when switching to OTP view
                    if (sendOtpBtn) {
                        const remaining = Math.max(0, otpExpiresAt - Date.now());
                        sendOtpBtn.disabled = remaining > 0;
                    }
                }
            });
        });

        if (pwdLoginBtn) {
            pwdLoginBtn.addEventListener('click', async () => {
                const cellphone = document.getElementById('sfCellphonePwd').value.trim();
                const password = document.getElementById('sfPassword').value.trim();
                if (!cellphone || !password) {
                    appendLog('شماره یا رمز عبور وارد نشده است');
                    return;
                }
                try {
                    appendLog('ورود با رمز عبور...');
                    const { token, expiryMs } = await sfLoginWithPassword({ cellphone, password });
                    saveSnappfoodToken(token, expiryMs);
                    if (typeof expiryMs === 'number') {
                        chrome.storage.sync.set({ [STORAGE_KEYS.sfTokenExpiry]: expiryMs }, () => {
                            setSnappfoodStatusUI({ token, expiry: expiryMs });
                        });
                    }
                    // Fetch vendors if empty
                    loadSnappfoodVendors(async (vendors) => {
                        if (!vendors || vendors.length === 0) {
                            try {
                                appendLog('در حال دریافت لیست وندورها...');
                                const list = await fetchSnappfoodVendors({ token });
                                saveSnappfoodVendors(list);
                            } catch (e2) {
                                appendLog(String(e2?.message || e2));
                            }
                        }
                    });
                } catch (e) {
                    appendLog(String(e?.message || e));
                }
            });
        }

        if (sendOtpBtn) {
            sendOtpBtn.addEventListener('click', async () => {
                const cellphone = document.getElementById('sfCellphoneOtp').value.trim();
                if (!cellphone) {
                    appendLog('شماره موبایل وارد نشده است');
                    return;
                }
                try {
                    appendLog('ارسال کد تایید...');
                    await sfSendOtp({ mobile_number: cellphone });
                    otpStep.style.display = '';
                    verifyOtpBtn.disabled = false;
                    // Disable send button during countdown
                    sendOtpBtn.disabled = true;
                    otpExpiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes
                    if (otpTimerId) clearInterval(otpTimerId);
                    otpTimerId = setInterval(updateOtpTimer, 250);
                    updateOtpTimer();
                } catch (e) {
                    appendLog(String(e?.message || e));
                    // Re-enable if sending failed
                    sendOtpBtn.disabled = false;
                }
            });
        }

        if (verifyOtpBtn) {
            verifyOtpBtn.addEventListener('click', async () => {
                if (Date.now() > otpExpiresAt) {
                    appendLog('مهلت وارد کردن کد به پایان رسیده است');
                    verifyOtpBtn.disabled = true;
                    return;
                }
                const cellphone = document.getElementById('sfCellphoneOtp').value.trim();
                const otpCodeStr = document.getElementById('sfOtpCode').value.trim();
                if (!cellphone || !otpCodeStr) {
                    appendLog('شماره یا کد وارد نشده است');
                    return;
                }
                const otpCode = Number(otpCodeStr);
                if (!Number.isInteger(otpCode)) {
                    appendLog('کد باید عددی باشد');
                    return;
                }
                try {
                    appendLog('تایید کد و ورود...');
                    const { token, expiryMs } = await sfVerifyOtp({ cellphone, otpCode });
                    saveSnappfoodToken(token, expiryMs);
                    if (typeof expiryMs === 'number') {
                        chrome.storage.sync.set({ [STORAGE_KEYS.sfTokenExpiry]: expiryMs }, () => {
                            setSnappfoodStatusUI({ token, expiry: expiryMs });
                        });
                    }
                    // Fetch vendors if empty
                    loadSnappfoodVendors(async (vendors) => {
                        if (!vendors || vendors.length === 0) {
                            try {
                                appendLog('در حال دریافت لیست وندورها...');
                                const list = await fetchSnappfoodVendors({ token });
                                saveSnappfoodVendors(list);
                            } catch (e2) {
                                appendLog(String(e2?.message || e2));
                            }
                        }
                    });
                } catch (e) {
                    appendLog(String(e?.message || e));
                }
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                chrome.storage.sync.set({ [STORAGE_KEYS.sfToken]: '', [STORAGE_KEYS.sfTokenExpiry]: 0 }, () => {
                    setSnappfoodStatusUI({ token: '', expiry: 0 });
                    appendLog('خروج از حساب اسنپفود انجام شد');
                });
            });
        }

        // Initialize status UI from storage and fetch vendors if needed
        loadSnappfoodToken(({ token, expiry }) => {
            setSnappfoodStatusUI({ token, expiry });
            if (token && expiry && Date.now() < expiry) {
                loadSnappfoodVendors(async (vendors) => {
                    if (!vendors || vendors.length === 0) {
                        try {
                            appendLog('در حال دریافت لیست وندورها...');
                            const list = await fetchSnappfoodVendors({ token });
                            saveSnappfoodVendors(list);
                        } catch (e) {
                            appendLog(String(e?.message || e));
                        }
                    }
                });
            }
        });
    });
})();


