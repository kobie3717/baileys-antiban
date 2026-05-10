#!/usr/bin/env node
"use strict";
/**
 * baileys-antiban CLI
 * Usage: npx baileys-antiban <command> [options]
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const persist_js_1 = require("./persist.js");
const presets_js_1 = require("./presets.js");
const args = process.argv.slice(2);
const command = args[0];
function parseArgs(argv) {
    const result = {};
    for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith('--')) {
                result[key] = next;
                i++;
            }
            else {
                result[key] = true;
            }
        }
    }
    return result;
}
function cmdStatus(opts) {
    const statePath = opts['state'];
    let warmupInfo = 'No state file (in-memory mode)';
    let savedAt = 'N/A';
    if (statePath) {
        const mgr = new persist_js_1.StateManager(statePath);
        const state = mgr.load();
        if (state) {
            const now = Date.now();
            const dayMs = 86400000;
            const currentDay = Math.floor((now - state.warmup.startedAt) / dayMs);
            warmupInfo = state.warmup.graduated
                ? 'Graduated (warmup complete)'
                : `Day ${currentDay + 1}, sent today: ${state.warmup.dailyCounts[currentDay] || 0}`;
            savedAt = new Date(state.savedAt).toISOString();
        }
        else {
            warmupInfo = 'State file missing or corrupt';
        }
    }
    const output = {
        warmup: warmupInfo,
        savedAt,
        statePath: statePath || null,
    };
    if (opts['json']) {
        console.log(JSON.stringify(output, null, 2));
    }
    else {
        console.log('═══ baileys-antiban status ═══');
        console.log(`Warmup:   ${output.warmup}`);
        console.log(`Saved:    ${output.savedAt}`);
        console.log(`State:    ${output.statePath || 'none'}`);
    }
}
function cmdReset(opts) {
    const statePath = opts['state'];
    if (!statePath) {
        console.error('Error: --state <path> required for reset');
        process.exit(1);
    }
    if (!fs.existsSync(statePath)) {
        console.log('State file does not exist — nothing to reset');
        return;
    }
    fs.unlinkSync(statePath);
    console.log(`✅ State file deleted: ${statePath}`);
}
function cmdWarmupSimulate(opts) {
    const days = parseInt(opts['simulate'] || '7', 10);
    const presetName = opts['preset'] || 'conservative';
    const cfg = (0, presets_js_1.resolveConfig)(presetName);
    console.log(`\nWarmup simulation — preset: ${presetName}, days: ${days}`);
    console.log('─'.repeat(50));
    const startDate = new Date();
    for (let day = 0; day < days; day++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + day);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const limit = Math.round(cfg.day1Limit * Math.pow(cfg.growthFactor, day));
        const bar = '█'.repeat(Math.min(30, Math.round(limit / 10)));
        console.log(`Day ${String(day + 1).padStart(2)} ${dayName.padEnd(15)} ${String(limit).padStart(5)} msgs/day  ${bar}`);
    }
    console.log('─'.repeat(50));
    console.log(`Day ${days + 1}+: graduated (unlimited by warmup)\n`);
}
// Main
const opts = parseArgs(args);
switch (command) {
    case 'status':
        cmdStatus(opts);
        break;
    case 'reset':
        cmdReset(opts);
        break;
    case 'warmup':
        if (opts['simulate']) {
            cmdWarmupSimulate(opts);
        }
        else {
            console.error('Usage: npx baileys-antiban warmup --simulate <days> [--preset conservative|moderate|aggressive]');
            process.exit(1);
        }
        break;
    default:
        console.log('baileys-antiban v3.0');
        console.log('');
        console.log('Commands:');
        console.log('  status [--state <path>] [--json]     Show warmup and health status');
        console.log('  reset --state <path>                  Delete state file');
        console.log('  warmup --simulate <days> [--preset]  Show warmup schedule');
        console.log('');
        console.log('Examples:');
        console.log('  npx baileys-antiban status --state ./antiban-state.json');
        console.log('  npx baileys-antiban warmup --simulate 7 --preset moderate');
        console.log('  npx baileys-antiban reset --state ./antiban-state.json');
}
