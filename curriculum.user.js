// ==UserScript==
// @name         重工课表【自动登录·缓存优先·iOS适配】
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  统一认证(CAS/OAuth)自动登录接力，验证码只填不提交；localStorage 缓存课表秒开渲染，后台 djb2 校验有变才刷新；一键同步到离线查看器(PWA)；零 GM_* 全 localStorage，@grant none，兼容 iOS Userscripts/Stay/夸克
// @match        https://njw.cqie.edu.cn/*
// @match        https://a.cqie.edu.cn/*
// @match        https://*.cqie.edu.cn/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* ================= 基础配置 ================= */
    var CONFIG = {
        debug: false,                       // 调试日志开关
        semesterStart: '2026-09-07',        // 开学日期（周一），用于推算周次与表头日期
        cacheKey: 'cqie_cc_cache_v2',       // 课表缓存 localStorage 键
        configKey: 'cqie_cc_config_v1',     // 设置（账号密码等）localStorage 键
        vmPollMs: 300,                      // 轮询 Vue 实例间隔（iOS 友好，不用 rAF）
        vmWaitMs: 25000,                    // 等待课表数据最长时间
        formWaitMs: 12000,                  // 等待登录表单最长时间
        rowHeight: 46,                      // 速览面板每小节高度(px)
        viewerUrl: 'https://joel-jiao.github.io/curriculum-pwa/'   // 离线查看器地址（PWA）
    };

    // 也可以直接把账号密码写在这里（跨域生效）；留空则用设置面板里保存的值
    var HARDCODED = { username: '', password: '' };

    function log() {
        if (CONFIG.debug && window.console) {
            var args = ['[课表助手]'].concat([].slice.call(arguments));
            console.log.apply(console, args);
        }
    }

    /* ================= localStorage 封装（零 GM_*） ================= */
    var store = {
        get: function (key, def) {
            try {
                var raw = window.localStorage.getItem(key);
                if (raw == null) return def;
                return JSON.parse(raw);
            } catch (e) { return def; }
        },
        set: function (key, val) {
            try { window.localStorage.setItem(key, JSON.stringify(val)); return true; }
            catch (e) { log('localStorage 写入失败', e); return false; }
        },
        remove: function (key) {
            try { window.localStorage.removeItem(key); } catch (e) {}
        }
    };

    var DEFAULT_SETTINGS = { username: '', password: '', autoLogin: true, autoWeek: true };
    function loadSettings() {
        var s = store.get(CONFIG.configKey, {}) || {};
        var out = {};
        Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
            if (s[k] !== undefined && s[k] !== null) out[k] = s[k];
            else out[k] = DEFAULT_SETTINGS[k];
        });
        if (!out.username && HARDCODED.username) out.username = HARDCODED.username;
        if (!out.password && HARDCODED.password) out.password = HARDCODED.password;
        return out;
    }
    var SETTINGS = loadSettings();

    /* ================= 通用工具 ================= */
    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $all(sel, ctx) { return [].slice.call((ctx || document).querySelectorAll(sel)); }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function pad2(n) { return String(n).padStart ? String(n).padStart(2, '0') : (n < 10 ? '0' + n : '' + n); }

    function fmtTime(ts) {
        if (!ts) return '';
        var d = new Date(ts);
        return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    // 可触摸设备（iOS）判断
    var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 1);

    // djb2 哈希 → 36 进制短串
    function djb2(str) {
        var h = 5381;
        str = String(str == null ? '' : str);
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) + h) + str.charCodeAt(i);
            h = h & h;
        }
        return (h >>> 0).toString(36);
    }

    /* ===== LZ-String 1.4.4 (MIT, github.com/pieroxy/lz-string) 仅压缩到 URL 安全串 ===== */
    var LZString = (function () {
        var keyStrUriSafe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
        function _compress(uncompressed, bitsPerChar, getCharFromInt) {
            if (uncompressed == null) return '';
            var i, value,
                context_dictionary = {}, context_dictionaryToCreate = {},
                context_c = '', context_wc = '', context_w = '',
                context_enlargeIn = 2, context_dictSize = 3, context_numBits = 2,
                context_data = [], context_data_val = 0, context_data_position = 0, ii;
            for (ii = 0; ii < uncompressed.length; ii += 1) {
                context_c = uncompressed.charAt(ii);
                if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
                    context_dictionary[context_c] = context_dictSize++;
                    context_dictionaryToCreate[context_c] = true;
                }
                context_wc = context_w + context_c;
                if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
                    context_w = context_wc;
                } else {
                    if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                        if (context_w.charCodeAt(0) < 256) {
                            for (i = 0; i < context_numBits; i++) {
                                context_data_val = (context_data_val << 1);
                                if (context_data_position == bitsPerChar - 1) {
                                    context_data_position = 0;
                                    context_data.push(getCharFromInt(context_data_val));
                                    context_data_val = 0;
                                } else context_data_position++;
                            }
                            value = context_w.charCodeAt(0);
                            for (i = 0; i < 8; i++) {
                                context_data_val = (context_data_val << 1) | (value & 1);
                                if (context_data_position == bitsPerChar - 1) {
                                    context_data_position = 0;
                                    context_data.push(getCharFromInt(context_data_val));
                                    context_data_val = 0;
                                } else context_data_position++;
                                value = value >> 1;
                            }
                        } else {
                            value = 1;
                            for (i = 0; i < context_numBits; i++) {
                                context_data_val = (context_data_val << 1) | value;
                                if (context_data_position == bitsPerChar - 1) {
                                    context_data_position = 0;
                                    context_data.push(getCharFromInt(context_data_val));
                                    context_data_val = 0;
                                } else context_data_position++;
                                value = 0;
                            }
                            value = context_w.charCodeAt(0);
                            for (i = 0; i < 16; i++) {
                                context_data_val = (context_data_val << 1) | (value & 1);
                                if (context_data_position == bitsPerChar - 1) {
                                    context_data_position = 0;
                                    context_data.push(getCharFromInt(context_data_val));
                                    context_data_val = 0;
                                } else context_data_position++;
                                value = value >> 1;
                            }
                        }
                        context_enlargeIn--;
                        if (context_enlargeIn == 0) {
                            context_enlargeIn = Math.pow(2, context_numBits);
                            context_numBits++;
                        }
                        delete context_dictionaryToCreate[context_w];
                    } else {
                        value = context_dictionary[context_w];
                        for (i = 0; i < context_numBits; i++) {
                            context_data_val = (context_data_val << 1) | (value & 1);
                            if (context_data_position == bitsPerChar - 1) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else context_data_position++;
                            value = value >> 1;
                        }
                    }
                    context_enlargeIn--;
                    if (context_enlargeIn == 0) {
                        context_enlargeIn = Math.pow(2, context_numBits);
                        context_numBits++;
                    }
                    context_dictionary[context_wc] = context_dictSize++;
                    context_w = String(context_c);
                }
            }
            if (context_w !== '') {
                if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                    if (context_w.charCodeAt(0) < 256) {
                        for (i = 0; i < context_numBits; i++) {
                            context_data_val = (context_data_val << 1);
                            if (context_data_position == bitsPerChar - 1) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else context_data_position++;
                        }
                        value = context_w.charCodeAt(0);
                        for (i = 0; i < 8; i++) {
                            context_data_val = (context_data_val << 1) | (value & 1);
                            if (context_data_position == bitsPerChar - 1) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else context_data_position++;
                            value = value >> 1;
                        }
                    } else {
                        value = 1;
                        for (i = 0; i < context_numBits; i++) {
                            context_data_val = (context_data_val << 1) | value;
                            if (context_data_position == bitsPerChar - 1) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else context_data_position++;
                            value = 0;
                        }
                        value = context_w.charCodeAt(0);
                        for (i = 0; i < 16; i++) {
                            context_data_val = (context_data_val << 1) | (value & 1);
                            if (context_data_position == bitsPerChar - 1) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else context_data_position++;
                            value = value >> 1;
                        }
                    }
                    context_enlargeIn--;
                    if (context_enlargeIn == 0) {
                        context_enlargeIn = Math.pow(2, context_numBits);
                        context_numBits++;
                    }
                    delete context_dictionaryToCreate[context_w];
                } else {
                    value = context_dictionary[context_w];
                    for (i = 0; i < context_numBits; i++) {
                        context_data_val = (context_data_val << 1) | (value & 1);
                        if (context_data_position == bitsPerChar - 1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else context_data_position++;
                        value = value >> 1;
                    }
                }
                context_enlargeIn--;
                if (context_enlargeIn == 0) {
                    context_enlargeIn = Math.pow(2, context_numBits);
                    context_numBits++;
                }
            }
            value = 2;
            for (i = 0; i < context_numBits; i++) {
                context_data_val = (context_data_val << 1) | (value & 1);
                if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                } else context_data_position++;
                value = value >> 1;
            }
            while (true) {
                context_data_val = (context_data_val << 1);
                if (context_data_position == bitsPerChar - 1) {
                    context_data.push(getCharFromInt(context_data_val));
                    break;
                } else context_data_position++;
            }
            return context_data.join('');
        }
        return {
            compressToEncodedURIComponent: function (input) {
                if (input == null) return '';
                return _compress(input, 6, function (a) { return keyStrUriSafe.charAt(a); });
            }
        };
    })();

    function isVisible(el) {
        if (!el) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return false;
        var st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
        return true;
    }

    // 兼容 Vue/React 的原生赋值
    function setNativeValue(el, value) {
        var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
        var desc = proto && Object.getOwnPropertyDescriptor(proto.prototype, 'value');
        try {
            if (!isTouch) el.focus();
        } catch (e) {}
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (el.type === 'text' && /pass|pwd|密码/i.test((el.id || '') + ' ' + (el.name || '') + ' ' + (el.placeholder || ''))) {
            el.type = 'password';
        }
    }

    /* ================= 周次计算 / 周次文本解析 ================= */
    function calcWeekNo() {
        var now = new Date();
        var start = new Date(CONFIG.semesterStart);
        var diffDay = Math.floor((now - start) / 86400000);
        var no = Math.floor(diffDay / 7) + 1;
        return no >= 1 ? no : 1;
    }

    // 解析 "1-16周"、"1,3,5-8"、"1-15单周"、"2-16(双)" 等
    function parseWeekText(text, maxWeek) {
        if (!text && text !== 0) return [];
        var s = String(text).replace(/[周\s\[\]()（）]/g, '').replace(/[，、；;]/g, ',');
        var out = [];
        s.split(',').forEach(function (part) {
            if (!part) return;
            var parity = 0; // 1=单 2=双
            if (part.indexOf('单') >= 0) { parity = 1; part = part.replace(/单/g, ''); }
            else if (part.indexOf('双') >= 0) { parity = 2; part = part.replace(/双/g, ''); }
            var m = part.match(/(\d+)\s*[-–~至]+\s*(\d+)/);
            if (m) {
                var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
                for (var i = a; i <= b; i++) {
                    if (parity === 1 && i % 2 !== 1) continue;
                    if (parity === 2 && i % 2 !== 0) continue;
                    out.push(i);
                }
            } else {
                var n = parseInt(part, 10);
                if (!isNaN(n)) out.push(n);
            }
        });
        var uniq = {};
        out.forEach(function (n) {
            if (n >= 1 && (!maxWeek || n <= maxWeek)) uniq[n] = 1;
        });
        return Object.keys(uniq).map(Number).sort(function (a, b) { return a - b; });
    }

    /* ================= 课表数据：读取 Vue 实例 → 归一化 → 按周缓存 ================= */
    function getCurriculumVM() {
        var el = $('.curriculum-box');
        if (el && el.__vue__ && el.__vue__.scheduleList !== undefined) return el.__vue__;
        // 兜底：从 #app 根组件向下找带 scheduleList/weekFinder 的组件
        var app = document.getElementById('app');
        if (app && app.__vue__) {
            var found = null, guard = 0;
            (function walk(vm) {
                if (found || guard++ > 400) return;
                if (vm && vm.scheduleList !== undefined && vm.weekFinder !== undefined) { found = vm; return; }
                (vm.$children || []).forEach(walk);
            })(app.__vue__);
            if (found) return found;
        }
        return null;
    }

    function normalizeItem(raw) {
        var pf = String(raw.periodFormat || '');
        var m = pf.match(/(\d+)\s*[-–~至]+\s*(\d+)/) || pf.match(/(\d+)/);
        var start = m ? parseInt(m[1], 10) : 0;
        var end = (m && m[2]) ? parseInt(m[2], 10) : start;

        var rooms = [];
        if (raw.roomName) rooms.push(raw.roomName);
        if (!rooms.length && raw.classTimeRoomManagerVOList && raw.classTimeRoomManagerVOList.length) {
            raw.classTimeRoomManagerVOList.forEach(function (r) {
                if (r && r.roomName) rooms.push(r.roomName);
            });
        }

        return {
            name: raw.courseName || raw.tempActType || (raw.status === '考试' ? '考试' : (raw.status || '课程')),
            classNbr: raw.classNbr || '',
            teacher: raw.instructorName || '',
            room: rooms.join('/'),
            day: parseInt(raw.weekDay, 10) || 0,     // 1=周一 … 7=周日
            start: start,
            end: end,
            weekText: raw.teachingWeekFormat || '',
            status: raw.status || '',
            timeIn: raw.timeIn || '',
            hourType: raw.hourType || '',
            allDay: !!raw.wholeWeekOccupy
        };
    }

    function courseHashKey(c) {
        return [c.name, c.classNbr, c.teacher, c.room, c.day, c.start, c.end,
            c.weekText, c.status, c.timeIn, c.hourType, c.allDay].join('|');
    }
    function hashCourseList(list) {
        var keys = (list || []).map(courseHashKey).sort();
        return djb2(keys.join('\n'));
    }

    // 全校统一作息时间（与周历页 .tc-time 一致），DOM 可读时以页面实际为准
    var DEFAULT_PERIOD_TIMES = ['08:30~09:15', '09:25~10:10', '10:30~11:15', '11:25~12:10',
        '14:00~14:45', '14:55~15:40', '16:00~16:45', '16:55~17:40',
        '19:00~19:45', '19:55~20:40', '20:50~21:35', '21:45~22:30'];

    function readPeriodTimes() {
        var nodes = $all('.week-body .time-col .tc-time');
        if (!nodes.length) nodes = $all('.time-col .tc-time');
        if (!nodes.length) return null;
        var arr = nodes.map(function (n) { return (n.textContent || '').replace(/\s/g, ''); }).filter(Boolean);
        return arr.length ? arr : null;
    }

    function buildCache(rawList, vm) {
        var maxWeek = vm.maxWeek || (vm.weekFinder && vm.weekFinder.length) || 0;
        var current = Number(vm.filterWeek);
        if (!(current >= 1)) current = calcWeekNo();

        var weeks = {}, hashes = {}, itemMax = 0;
        (rawList || []).forEach(function (raw) {
            if (raw.notArrangeTimeAndRoom) return;        // 未安排时间地点的课程不进周历
            var c = normalizeItem(raw);
            if (!c.day && !c.allDay) return;
            if (c.end > itemMax) itemMax = c.end;
            var ws = parseWeekText(c.weekText, maxWeek);
            ws.forEach(function (w) {
                if (!weeks[w]) weeks[w] = [];
                weeks[w].push(c);
            });
        });
        Object.keys(weeks).forEach(function (k) {
            weeks[k].sort(function (a, b) { return (a.day - b.day) || (a.start - b.start); });
            hashes[k] = hashCourseList(weeks[k]);
        });

        var periodTimes = readPeriodTimes() || DEFAULT_PERIOD_TIMES.slice();
        var maxPeriod = Math.max(periodTimes.length, itemMax);
        while (periodTimes.length < maxPeriod) periodTimes.push('');

        return {
            weeks: weeks,
            weekHashes: hashes,
            maxPeriod: maxPeriod,
            periodTimes: periodTimes,
            maxWeek: maxWeek || current,
            currentWeekNum: current,
            timestamp: Date.now()
        };
    }

    var cache = {
        read: function () { return store.get(CONFIG.cacheKey, null); },
        write: function (c) { return store.set(CONFIG.cacheKey, c); }
    };

    /* ================= 注入样式 ================= */
    var STYLE_TEXT = [
        '#cqie-cc-root{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
        '#cqie-cc-pill{position:fixed;left:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:2147483000;display:flex;align-items:center;',
        'padding:7px 12px;border-radius:18px;background:rgba(28,32,48,.92);color:#fff;font-size:12px;line-height:1.4;',
        'box-shadow:0 3px 14px rgba(0,0,0,.28);max-width:72vw;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}',
        '#cqie-cc-pill .cc-dot{width:8px;height:8px;border-radius:50%;background:#3ddc84;flex:none;margin-right:6px}',
        '#cqie-cc-pill.cc-busy .cc-dot{background:#ffb020;animation:ccblink 1s infinite}',
        '#cqie-cc-pill.cc-warn .cc-dot{background:#ff5c5c}',
        '@keyframes ccblink{50%{opacity:.25}}',
        '#cqie-cc-pill .cc-x{opacity:.55;padding:0 2px 0 6px;font-size:14px}',
        '#cqie-cc-panel{position:fixed;left:8px;right:8px;bottom:calc(46px + env(safe-area-inset-bottom));z-index:2147483001;background:#fff;color:#222;',
        'border-radius:14px;box-shadow:0 10px 36px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;',
        'max-height:74vh;border:1px solid #ececec}',
        '@media(min-width:720px){#cqie-cc-panel{left:auto;right:14px;width:430px}}',
        '.cc-p-head{display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid #f0f0f0;background:#fafbff}',
        '.cc-p-title{font-size:14px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.cc-p-sub{font-size:11px;color:#999;margin-top:1px}',
        '.cc-iconbtn{border:none;background:#f1f3f8;color:#555;border-radius:8px;width:30px;height:30px;font-size:14px;flex:none;padding:0;margin-left:6px}',
        '.cc-iconbtn:active{background:#e2e6f0}',
        '.cc-chips{display:flex;overflow-x:auto;padding:8px 10px;-webkit-overflow-scrolling:touch;background:#fff}',
        '.cc-chip{flex:none;margin-right:6px;border:1px solid #e3e6ef;background:#f7f8fc;color:#555;border-radius:14px;padding:4px 11px;font-size:12px}',
        '.cc-chip.cc-on{background:#3b74e8;border-color:#3b74e8;color:#fff;font-weight:600}',
        '.cc-body{overflow:auto;-webkit-overflow-scrolling:touch;padding:0 8px 10px}',
        '.cc-grid{display:flex;min-width:560px}',
        '.cc-gridhead{display:flex;min-width:560px}',
        '.cc-timecol{width:34px;flex:none}',
        '.cc-corner{height:34px}',
        '.cc-tlabel{height:' + '46' + 'px;font-size:10px;color:#bbb;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.15}',
        '.cc-tlabel i{font-size:8px;color:#b9bdc9;font-style:normal}',
        '.cc-days{flex:1;display:grid;grid-template-columns:repeat(7,1fr)}',
        '.cc-daycol{position:relative;border-left:1px dashed #eef0f5}',
        '.cc-dayhead{height:34px;text-align:center;font-size:11px;color:#666;background:#fff}',
        '.cc-dayhead b{display:block;font-size:12px;color:#333}',
        '.cc-dayhead.cc-today b{color:#3b74e8}',
        '.cc-dayhead.cc-today{background:#eef4ff;border-radius:6px}',
        '.cc-daycol .cc-bgline{height:' + '46' + 'px;border-bottom:1px dashed #f0f2f7}',
        '.cc-card{position:absolute;left:2px;right:2px;border-radius:7px;padding:3px 5px;font-size:11px;line-height:1.25;',
        'overflow:hidden;cursor:default;box-shadow:0 1px 3px rgba(0,0,0,.08)}',
        '.cc-card b{display:block;font-size:11px;font-weight:600;white-space:normal}',
        '.cc-card span{display:block;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.cc-card.cc-exam{background:#ffeef1!important;color:#c0354f!important}',
        '.cc-card.cc-temp{background:#fff7e8!important;color:#9a5a10!important}',
        '.cc-allday{padding:4px 10px 2px;font-size:11px;color:#888}',
        '.cc-allday .cc-tag{display:inline-block;background:#f0f2f8;border-radius:6px;padding:2px 6px;margin:2px 4px 2px 0;color:#555}',
        '.cc-empty{padding:34px 10px;text-align:center;color:#999;font-size:13px;line-height:1.8}',
        '#cqie-cc-modal{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483010;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:18px}',
        '.cc-m-box{background:#fff;border-radius:14px;width:100%;max-width:380px;padding:18px 16px;max-height:86vh;overflow:auto}',
        '.cc-m-box h3{margin:0 0 12px;font-size:16px}',
        '.cc-m-box label{display:block;font-size:12px;color:#777;margin:10px 0 4px}',
        '.cc-m-box input[type=text],.cc-m-box input[type=password]{width:100%;box-sizing:border-box;border:1px solid #dcdfe8;border-radius:9px;',
        'padding:10px 12px;font-size:14px;min-height:38px}',
        '.cc-m-row{display:flex;align-items:center;margin-top:12px;font-size:13px}',
        '.cc-m-row input{margin-right:8px}',
        '.cc-m-btns{display:flex;margin-top:16px}',
        '.cc-m-btns button{flex:1;min-height:40px;border-radius:10px;border:none;font-size:14px}',
        '.cc-m-btns button+button{margin-left:10px}',
        '.cc-btn-pri{background:#3b74e8;color:#fff}',
        '.cc-btn-ghost{background:#f1f3f8;color:#555}',
        '.cc-btn-danger{background:#fff0f0;color:#d84a4a;border:1px solid #ffd9d9!important;margin-top:10px;width:100%}',
        '.cc-m-tip{font-size:11px;color:#aaa;line-height:1.6;margin-top:10px}',
        '#cqie-cc-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483020;',
        'background:rgba(28,32,48,.94);color:#fff;font-size:13px;padding:9px 16px;border-radius:10px;max-width:86vw;text-align:center;',
        'box-shadow:0 4px 18px rgba(0,0,0,.3);opacity:0;transition:opacity .25s;pointer-events:none}',
        '#cqie-cc-toast.cc-show{opacity:1}',
        '#cqie-cc-gear{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483000;width:42px;height:42px;border-radius:50%;',
        'border:none;background:rgba(28,32,48,.9);color:#fff;font-size:18px;box-shadow:0 3px 12px rgba(0,0,0,.25)}'
    ].join('\n');

    var uiState = { weekNo: 0, vmWatcher: null, vmTimer: null, validating: false, shown: false };

    function injectStyle() {
        if ($('#cqie-cc-style')) return;
        var st = document.createElement('style');
        st.id = 'cqie-cc-style';
        st.textContent = STYLE_TEXT;
        (document.head || document.documentElement).appendChild(st);
    }

    function ensureRoot() {
        var root = $('#cqie-cc-root');
        if (root) return root;
        root = document.createElement('div');
        root.id = 'cqie-cc-root';
        root.innerHTML =
            '<div id="cqie-cc-pill" style="display:none"><span class="cc-dot"></span><span class="cc-txt">课表助手</span><span class="cc-x" title="收起">×</span></div>' +
            '<div id="cqie-cc-panel" style="display:none"></div>' +
            '<button id="cqie-cc-gear" style="display:none" title="课表助手设置">⚙</button>' +
            '<div id="cqie-cc-modal" style="display:none"></div>' +
            '<div id="cqie-cc-toast"></div>';
        document.body.appendChild(root);

        $('#cqie-cc-pill', root).addEventListener('click', function (e) {
            if (e.target.classList.contains('cc-x')) { togglePanel(false); return; }
            togglePanel();
        });
        $('#cqie-cc-panel', root).addEventListener('click', panelClickHandler, false);
        $('#cqie-cc-gear', root).addEventListener('click', openSettings);
        return root;
    }

    function setPill(text, kind, visible) {
        var root = ensureRoot();
        var pill = $('#cqie-cc-pill', root);
        pill.className = kind ? 'cc-' + kind : '';
        $('.cc-txt', pill).textContent = text;
        pill.style.display = visible === false ? 'none' : 'flex';
    }

    var toastTimer = null;
    function toast(msg) {
        var root = ensureRoot();
        var box = $('#cqie-cc-toast', root);
        box.textContent = msg;
        box.classList.add('cc-show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { box.classList.remove('cc-show'); }, 3200);
    }

    var PALETTE = [
        ['#eaf2ff', '#3b74e8'], ['#e9faf0', '#1f9d57'], ['#fff4e5', '#d97a13'],
        ['#f3ecff', '#7a4ddb'], ['#ffeef1', '#d84a6a'], ['#e6faf9', '#0f9488']
    ];

    function renderPanel(c, weekNo) {
        var root = ensureRoot();
        var panel = $('#cqie-cc-panel', root);
        if (!c) {
            panel.innerHTML = '<div class="cc-empty">暂无课表缓存<br/>登录后自动获取，下次进入可秒开<br/>' +
                '<button class="cc-iconbtn" data-act="settings" style="width:auto;height:34px;padding:0 14px;margin-top:8px">⚙ 设置</button></div>';
            return;
        }
        var maxWeek = c.maxWeek || Math.max.apply(null, Object.keys(c.weeks).map(Number).concat([c.currentWeekNum || 1]));
        if (!weekNo || weekNo < 1) weekNo = c.currentWeekNum || calcWeekNo();
        if (weekNo > maxWeek) weekNo = maxWeek;
        uiState.weekNo = weekNo;

        var monday = new Date(CONFIG.semesterStart);
        monday.setDate(monday.getDate() + (weekNo - 1) * 7);
        var now = new Date();
        var todayDow = now.getDay() === 0 ? 7 : now.getDay();
        var isThisWeek = (weekNo === c.currentWeekNum);
        var dayNames = ['一', '二', '三', '四', '五', '六', '日'];

        var chipsHtml = '';
        for (var w = 1; w <= maxWeek; w++) {
            chipsHtml += '<button class="cc-chip' + (w === weekNo ? ' cc-on' : '') + '" data-w="' + w + '">' +
                '第' + w + '周' + (w === c.currentWeekNum ? '•' : '') + '</button>';
        }

        var headHtml = '<div class="cc-timecol"><div class="cc-corner"></div></div><div class="cc-days">';
        for (var d = 1; d <= 7; d++) {
            var dd = new Date(monday);
            dd.setDate(dd.getDate() + d - 1);
            var todayCls = (isThisWeek && d === todayDow) ? ' cc-today' : '';
            headHtml += '<div class="cc-dayhead' + todayCls + '"><b>周' + dayNames[d - 1] + '</b>' +
                pad2(dd.getMonth() + 1) + '/' + pad2(dd.getDate()) + '</div>';
        }
        headHtml += '</div>';

        var maxPeriod = c.maxPeriod || DEFAULT_PERIOD_TIMES.length;
        var periodTimes = c.periodTimes || DEFAULT_PERIOD_TIMES;
        var gridHtml = '<div class="cc-timecol">';
        for (var p = 1; p <= maxPeriod; p++) {
            var tm = periodTimes[p - 1] || '';
            var tt = tm.split('~');
            var tLab = tt[0] ? tt[0] + (tt[1] ? '-' + tt[1] : '') : '';
            gridHtml += '<div class="cc-tlabel"><b>' + p + '</b><i>' + escapeHtml(tLab) + '</i></div>';
        }
        gridHtml += '</div><div class="cc-days">';

        var dayLists = {};
        (c.weeks[weekNo] || []).forEach(function (course) {
            if (!course.allDay && course.day >= 1 && course.day <= 7) {
                (dayLists[course.day] = dayLists[course.day] || []).push(course);
            }
        });

        for (var col = 1; col <= 7; col++) {
            gridHtml += '<div class="cc-daycol">';
            for (var r = 1; r <= maxPeriod; r++) gridHtml += '<div class="cc-bgline"></div>';
            (dayLists[col] || []).forEach(function (course) {
                var s0 = Math.max(1, course.start || 1);
                var span = Math.max(1, (course.end || s0) - s0 + 1);
                // djb2 存的是 36 进制短串，取色时还原为非负整数再取模
                var pal = PALETTE[Math.abs(parseInt(djb2(course.name), 36) || 0) % PALETTE.length] || PALETTE[0];
                var cls = 'cc-card';
                if (course.status === '考试') cls += ' cc-exam';
                else if (course.status && course.status.indexOf('临时') >= 0) cls += ' cc-temp';
                var bg = (cls.indexOf('cc-exam') < 0 && cls.indexOf('cc-temp') < 0) ?
                    ('background:' + pal[0] + ';color:' + pal[1] + ';') : '';
                var style = 'top:' + ((s0 - 1) * CONFIG.rowHeight) + 'px;height:' +
                    (span * CONFIG.rowHeight - 3) + 'px;' + bg;
                var title = escapeHtml([course.name, course.teacher, course.room,
                course.weekText ? '[' + course.weekText + '周]' : '', course.timeIn].filter(Boolean).join(' '));
                gridHtml += '<div class="' + cls + '" style="' + style + '" title="' + title + '">' +
                    '<b>' + escapeHtml(course.name) + '</b>' +
                    (course.teacher ? '<span>' + escapeHtml(course.teacher) + '</span>' : '') +
                    (course.room ? '<span>' + escapeHtml(course.room) + '</span>' : '') +
                    '<span>' + escapeHtml(course.start + '-' + course.end + '节') + '</span></div>';
            });
            gridHtml += '</div>';
        }
        gridHtml += '</div>';

        var allDay = (c.weeks[weekNo] || []).filter(function (x) { return x.allDay; });
        var allDayHtml = allDay.length ? '<div class="cc-allday">全天：' +
            allDay.map(function (x) { return '<span class="cc-tag">' + escapeHtml(x.name + (x.teacher ? '·' + x.teacher : '')) + '</span>'; }).join('') +
            '</div>' : '';

        var count = (c.weeks[weekNo] || []).length;
        var gridBlock = allDayHtml +
            '<div class="cc-gridhead">' + headHtml + '</div>' +
            '<div class="cc-grid">' + gridHtml + '</div>';
        var emptyBlock = '<div class="cc-empty">本周暂无课程安排<br/>' +
            '<button class="cc-iconbtn" data-act="settings" style="width:auto;height:34px;padding:0 14px;margin-top:8px">⚙ 设置</button></div>';
        panel.innerHTML =
            '<div class="cc-p-head"><div style="flex:1;min-width:0">' +
            '<div class="cc-p-title">第' + weekNo + '周课表' + (isThisWeek ? '（本周）' : '') + '</div>' +
            '<div class="cc-p-sub">共 ' + count + ' 项 · 数据更新于 ' + fmtTime(c.checkedAt || c.timestamp) + '</div></div>' +
            '<button class="cc-iconbtn" data-act="sync" title="同步到离线查看器">⇪</button>' +
            '<button class="cc-iconbtn" data-act="refresh" title="强制校验刷新">⟳</button>' +
            '<button class="cc-iconbtn" data-act="settings" title="设置">⚙</button>' +
            '<button class="cc-iconbtn" data-act="close" title="关闭">×</button></div>' +
            '<div class="cc-chips">' + chipsHtml + '</div>' +
            '<div class="cc-body">' + (count === 0 ? emptyBlock : gridBlock) + '</div>';
    }

    function panelClickHandler(e) {
        var chip = e.target.closest ? e.target.closest('.cc-chip') : null;
        if (chip && chip.dataset.w) {
            var c = cache.read();
            renderPanel(c, parseInt(chip.dataset.w, 10));
            return;
        }
        var btn = e.target.closest ? e.target.closest('[data-act]') : null;
        if (!btn) return;
        if (btn.dataset.act === 'close') togglePanel(false);
        else if (btn.dataset.act === 'settings') openSettings();
        else if (btn.dataset.act === 'refresh') manualValidate();
        else if (btn.dataset.act === 'sync') syncToViewer();
    }

    function togglePanel(force) {
        var panel = $('#cqie-cc-panel');
        var show = force === undefined ? panel.style.display === 'none' : force;
        panel.style.display = show ? 'flex' : 'none';
        uiState.shown = show;
        if (show) renderPanel(cache.read(), uiState.weekNo);
    }

    /* ================= 同步到离线查看器（PWA） ================= */
    function syncToViewer() {
        var c = cache.read();
        if (!c || !c.weeks || !Object.keys(c.weeks).length) {
            toast('暂无课表缓存可同步');
            return;
        }
        var base = (CONFIG.viewerUrl || '').trim();
        if (!base) {
            toast('请先在脚本顶部 CONFIG.viewerUrl 填入查看器地址');
            return;
        }
        var payload = {
            v: 1,
            semesterStart: CONFIG.semesterStart,
            currentWeekNum: c.currentWeekNum,
            maxWeek: c.maxWeek,
            maxPeriod: c.maxPeriod,
            periodTimes: c.periodTimes,
            weeks: c.weeks,
            updatedAt: c.checkedAt || c.timestamp || Date.now()
        };
        var enc = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
        window.open(base.replace(/[?#].*$/, '') + '#d=' + enc, '_blank');
        toast('已打开离线查看器，数据已携带在链接中');
    }

    function manualValidate() {
        if (uiState.validating) { toast('正在校验中…'); return; }
        var vm = getCurriculumVM();
        if (!vm) { toast('页面课表尚未就绪，稍候再试'); return; }
        toast('正在从服务器校验…');
        backgroundValidate(true, vm);
    }

    /* ================= 设置面板 ================= */
    function openSettings() {
        SETTINGS = loadSettings();
        var root = ensureRoot();
        var modal = $('#cqie-cc-modal', root);
        modal.innerHTML =
            '<div class="cc-m-box"><h3>课表助手设置</h3>' +
            '<label>账号（学号 / 工号）</label>' +
            '<input type="text" id="cc-set-user" autocomplete="off" value="' + escapeHtml(SETTINGS.username) + '"/>' +
            '<label>密码</label>' +
            '<input type="password" id="cc-set-pwd" autocomplete="new-password" value="' + escapeHtml(SETTINGS.password) + '"/>' +
            '<div class="cc-m-row"><input type="checkbox" id="cc-set-autologin"' + (SETTINGS.autoLogin ? ' checked' : '') + '/> 登录页自动填充并登录（验证码时只填不提交）</div>' +
            '<div class="cc-m-row"><input type="checkbox" id="cc-set-autoweek"' + (SETTINGS.autoWeek ? ' checked' : '') + '/> 进入课表自动切换到“周历”视图</div>' +
            '<div class="cc-m-btns"><button class="cc-btn-ghost" id="cc-set-cancel">关闭</button>' +
            '<button class="cc-btn-pri" id="cc-set-save">保存</button></div>' +
            '<button class="cc-btn-danger" id="cc-set-clear">清空本地课表缓存</button>' +
            '<div class="cc-m-tip">账号密码仅保存在本浏览器 localStorage 中，不会上传；登录页域名（a.cqie.edu.cn）与课表域名各自保存一份，也可直接在脚本顶部填写。</div>' +
            '</div>';
        modal.style.display = 'flex';

        $('#cc-set-save', modal).addEventListener('click', function () {
            SETTINGS = {
                username: $('#cc-set-user', modal).value.trim(),
                password: $('#cc-set-pwd', modal).value,
                autoLogin: $('#cc-set-autologin', modal).checked,
                autoWeek: $('#cc-set-autoweek', modal).checked
            };
            store.set(CONFIG.configKey, SETTINGS);
            modal.style.display = 'none';
            toast('设置已保存');
            if (isLoginHost()) armLoginForm();
        });
        $('#cc-set-cancel', modal).addEventListener('click', function () { modal.style.display = 'none'; });
        $('#cc-set-clear', modal).addEventListener('click', function () {
            cache.write(null);
            store.remove(CONFIG.cacheKey);
            toast('课表缓存已清空');
        });
        modal.onclick = function (e) { if (e.target === modal) modal.style.display = 'none'; };
    }

    /* ================= 后台校验（有变才刷新） ================= */
    function applyCacheMeta(dst, src) {
        dst.currentWeekNum = src.currentWeekNum;
        dst.maxPeriod = src.maxPeriod;
        dst.periodTimes = src.periodTimes;
        dst.maxWeek = src.maxWeek;
        dst.checkedAt = Date.now();
    }

    function backgroundValidate(force, vm) {
        if (uiState.validating) return Promise.resolve();
        uiState.validating = true;
        setPill('后台校验中…', 'busy');

        var done = function () { uiState.validating = false; };

        return Promise.resolve().then(function () {
            var items = vm.scheduleList || [];
            if (force && typeof vm.getScheduleList === 'function') {
                try {
                    var fresh = await2(vm.getScheduleList.call(vm, { session: vm.selectSessionId }));
                    return fresh.then(function (list) {
                        if (list && list.length) items = list;
                        return compareAndSave(items, vm, true);
                    }).catch(function () { return compareAndSave(items, vm, true); });
                } catch (e) {
                    return compareAndSave(items, vm, true);
                }
            }
            return compareAndSave(items, vm, false);
        }).then(done, function (err) {
            log('校验异常', err);
            setPill('校验失败，将使用缓存', 'warn');
            done();
        });
    }

    // 不使用 async 关键字（最大化旧 WebKit 兼容），对 Vue 的 Promise 包一层
    function await2(p) { return Promise.resolve(p); }

    function compareAndSave(items, vm, force) {
        var built = buildCache(items, vm);
        if (!built.maxWeek && !items.length) {
            setPill('课表数据为空，稍后重试', 'warn');
            return;
        }
        var old = cache.read();
        var oldEmpty = !old || !old.weekHashes || !Object.keys(old.weekHashes).length;

        if (oldEmpty) {
            cache.write(built);
            renderPanel(built, built.currentWeekNum);
            setPill('课表已缓存 · ' + fmtTime(built.timestamp));
            log('首次缓存');
            return;
        }

        var changed;
        var oldKeys = Object.keys(old.weekHashes), newKeys = Object.keys(built.weekHashes);
        if (force) {
            // 双向比对：新增 / 删除 / 内容变化均算变更
            changed = oldKeys.length !== newKeys.length;
            if (!changed) changed = newKeys.some(function (k) { return old.weekHashes[k] !== built.weekHashes[k]; });
        } else {
            // 静默校验：只比对当前周哈希
            changed = old.weekHashes[built.currentWeekNum] !== built.weekHashes[built.currentWeekNum];
        }

        if (changed) {
            cache.write(built);
            renderPanel(built, uiState.weekNo || built.currentWeekNum);
            setPill('课表已更新 · ' + fmtTime(built.timestamp), 'warn');
            toast('课表有更新，已刷新');
            log('检测到变化，已重建全部周次缓存');
        } else {
            applyCacheMeta(old, built);
            cache.write(old);
            // 无变化：只更新状态条，不重绘面板，用户无感知
            setPill('课表无变化 · ' + fmtTime(Date.now()));
            log('课表无变化');
        }
    }

    /* ================= 课表页：等待 VM → 校验；学期切换监听 ================= */
    function startValidationLoop() {
        if (uiState.vmTimer) clearInterval(uiState.vmTimer);
        var tries = Math.ceil(CONFIG.vmWaitMs / CONFIG.vmPollMs), n = 0;
        uiState.vmTimer = setInterval(function () {
            n++;
            var vm = getCurriculumVM();
            var ready = vm && vm.scheduleList && vm.scheduleList.length && !vm.skeleton && !vm.listLoading;
            if (ready) {
                clearInterval(uiState.vmTimer);
                uiState.vmTimer = null;
                backgroundValidate(false, vm);
                // 监听学期切换 / 数据重载（Vue 响应式 watcher，开销极小，iOS 友好）
                if (!uiState.vmWatcher && typeof vm.$watch === 'function') {
                    uiState.vmWatcher = vm.$watch(function () {
                        return String(this.selectSessionId) + ':' +
                            (this.scheduleList ? this.scheduleList.length : 0) + ':' +
                            (this.filterWeek);
                    }, function (n, o) {
                        var np = String(n).split(':'), op = String(o).split(':');
                        // 切换周次：重标原生表头日期
                        if (np[2] !== op[2]) scheduleAnnotate();
                        // 切换学期 / 数据重载：后台静默校验
                        if (np[0] !== op[0] || np[1] !== op[1]) {
                            var cur = getCurriculumVM();
                            if (cur && cur.scheduleList && cur.scheduleList.length && !uiState.validating) {
                                backgroundValidate(false, cur);
                            }
                        }
                    });
                }
            } else if (n >= tries) {
                clearInterval(uiState.vmTimer);
                uiState.vmTimer = null;
                if (cache.read()) setPill('缓存模式（页面数据未就绪）', 'warn');
                else setPill('课表数据加载超时', 'warn');
            }
        }, CONFIG.vmPollMs);
    }

    /* ================= 原生页面：自动周视图 + 表头日期标注 ================= */
    function injectDayDateStyle() {
        if ($('#cc-daydate-style')) return;
        var style = document.createElement('style');
        style.id = 'cc-daydate-style';
        style.textContent = '.week-header .day-head .day-date{display:block;font-size:11px;color:#999;line-height:1.2}' +
            '.week-header .day-head.day-date-today{color:#3b74e8}' +
            '.week-header .day-head.day-date-today .day-date{color:#3b74e8;font-weight:600}';
        document.head.appendChild(style);
    }

    function annotateDayDates() {
        var heads = $all('.week-header .day-head');
        if (!heads.length) return;
        var vm = getCurriculumVM();
        var weekNo = Number(vm && vm.filterWeek);
        if (!(weekNo >= 1)) weekNo = calcWeekNo();

        var monday = new Date(CONFIG.semesterStart);
        monday.setDate(monday.getDate() + (weekNo - 1) * 7);

        var nowD = new Date();
        var todayMonthDay = pad2(nowD.getMonth() + 1) + '/' + pad2(nowD.getDate());

        heads.forEach(function (head, i) {
            var d = new Date(monday);
            d.setDate(d.getDate() + i);
            var label = pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
            var span = head.querySelector('.day-date');
            if (!span) {
                span = document.createElement('span');
                span.className = 'day-date';
                head.appendChild(span);
            }
            if (span.textContent !== label) span.textContent = label;
            if (label === todayMonthDay && weekNo === calcWeekNo()) head.classList.add('day-date-today');
            else head.classList.remove('day-date-today');
        });
    }

    var annotateTimer = null;
    function scheduleAnnotate() {
        if (annotateTimer) clearTimeout(annotateTimer);
        annotateTimer = setTimeout(annotateDayDates, 150);
    }

    function clickNativeWeekRadio() {
        if (!SETTINGS.autoWeek) return;
        var input = $('input.ant-radio-button-input[value="week"]');
        if (!input || input.checked) return;
        var label = input.closest('label') || input.parentElement;
        try {
            if (label && label.click) label.click();
            else {
                input.checked = true;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('click', { bubbles: true }));
            }
            log('已切换到周历视图');
        } catch (e) {}
    }

    var nativeTimer = null;
    function startNativeWeekAutomation() {
        injectDayDateStyle();
        if (nativeTimer) clearInterval(nativeTimer);
        var n = 0;
        nativeTimer = setInterval(function () {
            n++;
            if ($('input.ant-radio-button-input[value="week"]')) {
                clickNativeWeekRadio();
                scheduleAnnotate();
                clearInterval(nativeTimer);
                nativeTimer = null;
            } else if (n >= 40) {
                clearInterval(nativeTimer);
                nativeTimer = null;
            }
        }, 500);
    }

    /* ================= 课表页启动 / 卸载 ================= */
    function startCurriculum() {
        injectStyle();
        var root = ensureRoot();
        $('#cqie-cc-gear', root).style.display = 'block';
        setPill('课表助手启动中…', 'busy', true);

        var c = cache.read();
        if (c && c.weeks) {
            // 缓存优先：立即秒渲染
            renderPanel(c, c.currentWeekNum || calcWeekNo());
            setPill('缓存秒开 · 更新于 ' + fmtTime(c.checkedAt || c.timestamp));
        } else {
            var panel = $('#cqie-cc-panel', root);
            panel.innerHTML = '<div class="cc-empty">暂无课表缓存<br/>登录后自动获取，下次进入可秒开<br/>' +
                '<button class="cc-iconbtn" data-act="settings" style="width:auto;height:34px;padding:0 14px;margin-top:8px">⚙ 设置</button></div>';
            setPill('等待课表数据…', 'busy');
        }

        startNativeWeekAutomation();
        startValidationLoop();
        scheduleAnnotate();
    }

    function teardown() {
        if (uiState.vmTimer) { clearInterval(uiState.vmTimer); uiState.vmTimer = null; }
        if (uiState.vmWatcher) { try { uiState.vmWatcher(); } catch (e) {} uiState.vmWatcher = null; }
        if (nativeTimer) { clearInterval(nativeTimer); nativeTimer = null; }
        if (annotateTimer) { clearTimeout(annotateTimer); annotateTimer = null; }
        uiState.validating = false;
        var root = $('#cqie-cc-root');
        if (root) root.parentNode.removeChild(root);
        var st = $('#cqie-cc-style');
        if (st) st.parentNode.removeChild(st);
        var ds = $('#cc-daydate-style');
        if (ds) ds.parentNode.removeChild(ds);
        $all('.week-header .day-head .day-date').forEach(function (s) { s.parentNode.removeChild(s); });
    }

    /* ================= 自动登录（CAS / SSO 接力） ================= */
    function isLoginHost() {
        // 统一认证在独立子域 a.cqie.edu.cn；兼容跳转链上其它可能的登录子域，但排除应用主域
        return location.hostname !== 'njw.cqie.edu.cn' &&
            location.hostname.endsWith('cqie.edu.cn');
    }

    function findLoginForm() {
        var pwd = $('input[type="password"]') || $('input[placeholder*="密码"]') || $('#password');
        if (!pwd) return null;
        return {
            form: (pwd.form || (pwd.closest && pwd.closest('form')) || document),
            pwdInputs: collectPasswordInputs(),
            userInput: collectUserInput()
        };
    }

    function collectPasswordInputs() {
        // CAS 页有多个同 id/name 的隐藏诱饵框，只填可见的真框，避免触发反爬
        var inForm = $all('#loginForm input');
        if (inForm.length) {
            var vis = inForm.filter(function (el) {
                return (el.name === 'password' || el.id === 'password') && isVisible(el);
            });
            if (vis.length) return vis;
        }
        var generic = $all('input[type="password"],input[placeholder*="密码"]').filter(isVisible);
        if (generic.length) return generic;
        return $all('input[name="password"]');
    }

    function collectUserInput() {
        // CAS：真框可见（name=username），隐藏的无 name 同 id 诱饵框不填
        var inForm = $all('#loginForm input');
        if (inForm.length) {
            var vis = inForm.filter(function (el) {
                var t = (el.type || 'text').toLowerCase();
                return t !== 'hidden' && t !== 'password' && t !== 'submit' && t !== 'button' &&
                    (el.name === 'username' || el.id === 'username') && isVisible(el);
            });
            if (vis.length) return vis;
            var cas = $all('#loginForm input[name="username"],#loginForm #username0');
            if (cas.length) return cas;
        }
        // 通用 SSO 页面：按关键字评分
        var scope = document;
        var visible = $all('input', scope).filter(function (el) {
            var t = (el.type || 'text').toLowerCase();
            return t !== 'password' && t !== 'hidden' && t !== 'submit' && t !== 'button' &&
                t !== 'checkbox' && t !== 'radio' && isVisible(el);
        });
        var kw = /user|name|account|login|sid|yhm|xuehao|学号|工号|账号|用户|手机|email|mail/i;
        var scored = visible.map(function (el) {
            var sig = (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.autocomplete || '');
            return { el: el, s: kw.test(sig) ? 1 : 0 };
        }).filter(function (x) { return x.s; }).sort(function (a, b) { return b.s - a.s; });
        if (scored.length) return [scored[0].el];
        return visible.length ? [visible[0]] : [];
    }

    function captchaRequired(form) {
        var scope = form || document;
        var inputs = $all('input[name="authCode"],#authCode,input[name*="captcha"],input[name*="verifyCode"],input[placeholder*="验证码"]', scope);
        for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            // 真实验证码框可见才算需要
            if ((el.name === 'authCode' || /captcha|verify|验证码/i.test((el.name || '') + (el.placeholder || ''))) && isVisible(el)) return true;
        }
        var imgs = $all('img', scope).filter(function (im) {
            var sig = (im.id || '') + ' ' + (im.src || '') + ' ' + (im.className || '');
            return /captcha|verify|authCode|验证码/i.test(sig) && isVisible(im);
        });
        return imgs.length > 0;
    }

    function loginErrorMessage() {
        var nodes = $all('#err,#msg,.auth_error,.error-message,.login-error,.tip-error');
        for (var i = 0; i < nodes.length; i++) {
            var t = (nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
            if (t && isVisible(nodes[i])) return t;
        }
        return '';
    }

    function fillCredentials(scope) {
        var info = findLoginForm();
        if (!info) return false;
        var users = collectUserInput();
        var pwds = collectPasswordInputs();
        users.forEach(function (el) {
            if (el.value !== SETTINGS.username) setNativeValue(el, SETTINGS.username);
        });
        pwds.forEach(function (el) {
            if (el.value !== SETTINGS.password) setNativeValue(el, SETTINGS.password);
        });
        log('已填充账号密码（用户框' + users.length + ' 密码框' + pwds.length + '）');
        return !!(users.length && pwds.length);
    }

    function clickLoginButton(form) {
        var btn = $('#loginForm button.btn.blue,button.btn-login,button[type="submit"],input[type="submit"]', form);
        if (!btn || !isVisible(btn)) {
            var cands = $all('button,a.btn,a.button,[role="button"]', form).filter(function (b) {
                return isVisible(b) && /登\s*录|login|sign\s*in/i.test(b.textContent || '');
            });
            btn = cands[0];
        }
        if (btn) {
            ['mousedown', 'mouseup', 'click'].forEach(function (type) {
                btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
            });
            if (btn.click) btn.click();
            log('点击登录按钮');
            return true;
        }
        return false;
    }

    var loginArmed = false;
    function attemptLogin() {
        if (!SETTINGS.autoLogin) return;
        var info = findLoginForm();
        if (!info) return;
        var form = info.form;
        if (form.dataset && form.dataset.ccFilled === '1') return;   // 本次加载已处理，防重复提交

        var err = loginErrorMessage();
        var needCaptcha = captchaRequired(form);

        if (!SETTINGS.username || !SETTINGS.password) {
            toast('课表助手：请点右下角 ⚙ 设置账号密码');
            return;
        }

        var ok = fillCredentials(form);
        if (!ok) return;
        if (form.dataset) form.dataset.ccFilled = '1';

        if (err) {
            // 页面带着错误回来（如密码错误）：只填不提交，防止锁号循环
            toast('登录页有错误提示，已填充账号，请手动处理');
            return;
        }
        if (needCaptcha) {
            // 验证码：只填不提交
            toast('检测到验证码：账号密码已填充，输入验证码后请手动登录');
            return;
        }

        setTimeout(function () {
            if (typeof window._systemLogin === 'function') {
                try { window._systemLogin(); log('调用 _systemLogin 提交'); }
                catch (e) { clickLoginButton(form); }
            } else {
                clickLoginButton(form);
            }
            // 提交后若仍停留在登录页且出现错误，提示一次，绝不重试
            setTimeout(function () {
                var msg = loginErrorMessage();
                if (msg) toast('自动登录未成功：' + msg);
            }, 6000);
        }, 350);
    }

    var formTimer = null, formObserver = null;
    function armLoginForm() {
        SETTINGS = loadSettings();
        injectStyle();
        var root = ensureRoot();
        $('#cqie-cc-gear', root).style.display = 'block';

        if (loginArmed) {
            // 设置更新后重新放行一次
            var f = $('#loginForm') || document.querySelector('form');
            if (f && f.dataset) f.dataset.ccFilled = '';
            attemptLogin();
            return;
        }
        loginArmed = true;
        var n = 0;
        formTimer = setInterval(function () {
            n++;
            if (findLoginForm()) {
                clearInterval(formTimer);
                formTimer = null;
                attemptLogin();
            } else if (n >= Math.ceil(CONFIG.formWaitMs / 300)) {
                clearInterval(formTimer);
                formTimer = null;
            }
        }, 300);

        // SSO 跳转链上后续登录页若在同一文档内渲染，继续接力
        formObserver = new MutationObserver(function () {
            if (!findLoginForm()) return;
            var f = $('#loginForm') || document.querySelector('form');
            if (f && f.dataset && f.dataset.ccFilled !== '1') attemptLogin();
        });
        formObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    /* ================= 路由判断与 SPA 监听 ================= */
    function isCurriculumPage() {
        return location.hostname === 'njw.cqie.edu.cn' &&
            location.href.indexOf('/workspace/curriculum') >= 0;
    }

    function bootstrap() {
        if (!document.body) {
            setTimeout(bootstrap, 100);
            return;
        }
        if (isCurriculumPage()) startCurriculum();
        else if (isLoginHost()) armLoginForm();
    }

    var lastUrl = location.href;
    var spaObserver = new MutationObserver(function () {
        if (location.href === lastUrl) {
            if (isCurriculumPage()) scheduleAnnotate();
            return;
        }
        var wasCurriculum = lastUrl.indexOf('/workspace/curriculum') >= 0;
        lastUrl = location.href;
        if (wasCurriculum && !isCurriculumPage()) teardown();
        bootstrap();
    });
    spaObserver.observe(document.documentElement, { childList: true, subtree: true });

    bootstrap();
})();
