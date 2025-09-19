(function () {
    function getOwnText(el) {
        if (!el) return '';
        const parts = [];
        el.childNodes.forEach(n => { if (n.nodeType === 3) parts.push(n.nodeValue || ''); });
        return parts.join(' ').replace(/[\u200c\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim();
    }

    function findTargetTableBodies() {
        const bodies = Array.from(document.querySelectorAll('tbody'));
        return bodies.filter(tb => {
            const headerRow = tb.querySelector('tr');
            if (!headerRow) return false;
            const ths = Array.from(headerRow.querySelectorAll('th'));
            const names = ths.map(th => th.getAttribute('data-name'));
            return names.includes('VUserName') && names.includes('FirstName') && names.includes('Price') && names.includes('TrackingCode');
        });
    }

    function ensureHeaderHasSmsColumn(tbody) {
        const headerRow = tbody.querySelector('tr');
        if (!headerRow) return;
        const ths = Array.from(headerRow.querySelectorAll('th'));
        const vUserIndex = ths.findIndex(th => th.getAttribute('data-name') === 'VUserName');
        if (vUserIndex === -1) return;
        const exists = headerRow.querySelector('th[data-name="SmsAction"]');
        if (exists) return;
        const th = document.createElement('th');
        th.setAttribute('data-name', 'SmsAction');
        th.textContent = 'ارسال پیامک';
        // insert after VUserName column
        if (headerRow.children[vUserIndex + 1]) {
            headerRow.insertBefore(th, headerRow.children[vUserIndex + 1]);
        } else {
            headerRow.appendChild(th);
        }
    }

    function addButtonsToRows(tbody) {
        const rows = Array.from(tbody.querySelectorAll('tr'));
        // skip header (first tr has th children)
        rows.slice(1).forEach(row => {
            const firstNameCell = row.querySelector('td[data-name="FirstName"]');
            const priceCell = row.querySelector('td[data-name="Price"]');
            const vUserNameCell = row.querySelector('td[data-name="VUserName"]');
            const trackingCodeCell = row.querySelector('td[data-name="TrackingCode"]');
            const branchNameCell = row.querySelector('td[data-name="BranchName"]');
            const dateTimeCell = row.querySelector('td[data-name="DateTime"]');
            if (!firstNameCell || !priceCell || !vUserNameCell || !trackingCodeCell) return;

            // Avoid duplicate cell
            const existingActionCell = row.querySelector('td[data-name="SmsAction"]');
            if (existingActionCell) return;

            const td = document.createElement('td');
            td.setAttribute('data-name', 'SmsAction');
            const btn = document.createElement('button');
            btn.className = 'sf-sms-btn';
            btn.textContent = 'ارسال پیامک';
            btn.style.padding = '3px 8px';
            btn.style.borderRadius = '6px';
            btn.style.border = '1px solid #15803d';
            btn.style.background = '#16a34a';
            btn.style.color = '#ffffff';
            btn.style.cursor = 'pointer';
            btn.style.whiteSpace = 'nowrap';
            // Enable only if trackingCode is exactly "snappfood"
            const trackingRaw = trackingCodeCell ? (trackingCodeCell.innerText || '').trim() : '';
            const trackingNorm = trackingRaw.toLowerCase();
            if (trackingNorm !== 'snappfood') {
                btn.disabled = true;
                btn.style.background = '#9ca3af';
                btn.style.border = '1px solid #9ca3af';
                btn.style.cursor = 'not-allowed';
            }
            btn.addEventListener('click', async () => {
                if (btn.disabled) return;
                const firstName = firstNameCell.innerText.replace(/\s+/g, ' ').trim();
                const price = priceCell.innerText.replace(/\s+/g, ' ').trim();
                const vUserName = (vUserNameCell.innerText || '').replace(/\s+/g, ' ').trim();
                const trackingCode = trackingCodeCell.innerText.replace(/\s+/g, ' ').trim();
                const branchName = branchNameCell ? getOwnText(branchNameCell) : '';
                const dateTime = dateTimeCell ? getOwnText(dateTimeCell) : '';

                function normalize(str) { return (str || '').replace(/[\u200c\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim(); }
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

                const dateTimeG = jalaliToGregorian(dateTime);

                const prevText = btn.textContent; btn.disabled = true; btn.textContent = 'در حال پردازش...';
                chrome.storage.sync.get(['sf_vendors', 'sf_token'], async (data) => {
                    try {
                        const vendors = Array.isArray(data['sf_vendors']) ? data['sf_vendors'] : [];
                        const bn = normalize(branchName);
                        let match = null;
                        for (const v of vendors) {
                            const title = normalize(v.title);
                            if (!title) continue;
                            if (title.includes(`(${bn})`) || title === bn || (bn && title.includes(bn))) { match = v; break; }
                        }
                        const vendorId = match ? match.id : '';

                        const token = normalizeSnappfoodToken(data['sf_token']);

                        if (vendorId && token && dateTimeG) {
                            const start = `${dateTimeG} 00:00:00`;
                            const end = `${dateTimeG} 23:59:00`;
                            const url = `https://vendor.snappfood.ir/vms/v2/order/list?vendorId=${encodeURIComponent(vendorId)}&pageSize=20&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&page=0`;
                            const { ok, status, text, error } = await chrome.runtime.sendMessage({
                                type: 'SF_FETCH',
                                url,
                                method: 'GET',
                                headers: { Authorization: `Bearer ${token}` }
                            });
                            if (!ok) {
                                console.log('fetch error:', status, error || text);
                            } else {
                                let response = {};
                                try { response = JSON.parse(text) || {}; } catch (_) { }
                                //console.log('API response:', response);

                                // Handle different response structures
                                let orders = [];
                                if (Array.isArray(response)) {
                                    orders = response;
                                } else if (Array.isArray(response.data)) {
                                    orders = response.data;
                                } else if (Array.isArray(response.included)) {
                                    orders = response.included.filter(item => item.type === 'order');
                                }

                                const target = orders.find(x => normalize(x?.attributes?.customerName) === normalize(firstName));
                                // console.log({ firstName, price, vUserName, trackingCode, branchName, vendorId, dateTimeG, matchedOrder: target || null, totalOrders: orders.length });

                                if (!target?.attributes?.code) {
                                    btn.textContent = 'انجام نشد!';
                                    btn.disabled = false;
                                    return;
                                }

                                const URL_OVERRIDE_FOR_TEMPLATE = `https://link.sib360.com/${target.attributes.code}`;
                                chrome.storage.sync.get(['sms_template'], (d) => {
                                    const tpl = typeof d['sms_template'] === 'string' ? d['sms_template'] : '';
                                    if (!tpl) return;
                                    let smsText = tpl.replace(/\{url\}/g, URL_OVERRIDE_FOR_TEMPLATE || '{url}');
                                    smsText = smsText.replace(/\{name\}/g, firstName || '{name}');
                                    console.log('SMS text preview:', smsText);

                                    // Prepare to send SMS: add a leading 0 to vUserName
                                    const phone = vUserName ? ('0' + vUserName.replace(/^0+/, '')) : '';
                                    if (!phone) {
                                        btn.textContent = 'انجام نشد!';
                                        btn.disabled = false;
                                        return;
                                    }

                                    chrome.storage.sync.get(['sms_api_url','sms_auth_token'], async (cfg) => {
                                        const apiUrl = cfg['sms_api_url'] || '';
                                        const authToken = cfg['sms_auth_token'] || '';
                                        if (!apiUrl || !authToken) {
                                            btn.textContent = 'انجام نشد!';
                                            btn.disabled = false;
                                            return;
                                        }
                                        try {
                                            const payload = {
                                                ProviderId: 1,
                                                Number: phone,
                                                Message: smsText
                                            };
                                            const { ok, status, text, error } = await chrome.runtime.sendMessage({
                                                type: 'SF_FETCH',
                                                url: apiUrl,
                                                method: 'POST',
                                                headers: { 'Authorization': authToken, 'Content-Type': 'application/json' },
                                                body: payload
                                            });
                                            if (!ok || (status && status >= 300)) {
                                                console.log('SMS send failed:', status, error || text);
                                                btn.textContent = 'انجام نشد!';
                                                btn.disabled = false;
                                            } else {
                                                btn.textContent = `ارسال شد!`;
                                                btn.disabled = true;
                                            }
                                        } catch (e) {
                                            console.log('SMS send error:', e);
                                            btn.textContent = 'انجام نشد!';
                                            btn.disabled = false;
                                        }
                                    });
                                });
                            }
                        } else {
                            //console.log({ firstName, price, vUserName, trackingCode, branchName, vendorId, dateTimeG, note: 'vendorId/token/dateTimeG missing' });
                        }
                    } catch (e) {
                        console.log('process error:', e);
                    } finally {
                        btn.disabled = false; btn.textContent = prevText;
                    }
                });
            });
            td.appendChild(btn);

            // Insert new cell right after VUserName cell
            if (vUserNameCell.nextSibling) {
                vUserNameCell.parentNode.insertBefore(td, vUserNameCell.nextSibling);
            } else {
                vUserNameCell.parentNode.appendChild(td);
            }
        });
    }

    function process() {
        const bodies = findTargetTableBodies();
        bodies.forEach(tb => {
            ensureHeaderHasSmsColumn(tb);
            addButtonsToRows(tb);
        });
    }

    // Initial run
    process();

    // Observe for dynamic changes
    const observer = new MutationObserver(() => {
        try { process(); } catch (e) { }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });

    function jalaliToGregorian(dateTimeStr) {
        // حذف متن فارسی "در ساعت"
        const cleaned = dateTimeStr.replace("در ساعت", "").trim();

        // جدا کردن تاریخ و زمان
        const [datePart] = cleaned.split(" ");
        const [jy, jm, jd] = datePart.split("/").map(Number);

        // تبدیل به میلادی
        const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);

        // برگردوندن خروجی به فرمت YYYY-M-D
        return `${gy}-${gm}-${gd}`;
    }
})();