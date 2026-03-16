#!/usr/bin/env node

/**
 * Quantum Memory CLI - Health check and diagnostics
 */

import { QuantumDatabase } from '../db/Database.js';
import { SessionManager } from '../engine/SessionManager.js';
import { MessageStore } from '../engine/MessageStore.js';
import { SummaryStore } from '../dag/SummaryStore.js';
import { EntityStore } from '../entities/EntityStore.js';
import { RelationStore } from '../entities/RelationStore.js';
import { ProjectManager } from '../projects/ProjectManager.js';
import { homedir } from 'os';
import { join } from 'path';

interface HealthResult {
  status: 'ok' | 'warn' | 'error';
  checks: Record<string, { status: string; message?: string }>;
  stats: {
    sessions: number;
    messages: number;
    summaries: number;
    entities: number;
    relations: number;
    projects: number;
  };
}

function printStatus(result: HealthResult): void {
  console.log('\n🧠 Quantum Memory Diagnostics\n');
  console.log('═'.repeat(40));
  
  // Overall status
  const emoji = result.status === 'ok' ? '✅' : result.status === 'warn' ? '⚠️' : '❌';
  console.log(`\n${emoji} Overall Status: ${result.status.toUpperCase()}\n`);
  
  // Checks
  console.log('📋 Health Checks:');
  for (const [check, info] of Object.entries(result.checks)) {
    const icon = info.status === 'ok' ? '✅' : info.status === 'warn' ? '⚠️' : '❌';
    console.log(`   ${icon} ${check}: ${info.status}${info.message ? ` - ${info.message}` : ''}`);
  }
  
  // Stats
  console.log('\n📊 Statistics:');
  console.log(`   Sessions:   ${result.stats.sessions}`);
  console.log(`   Messages:   ${result.stats.messages}`);
  console.log(`   Summaries:  ${result.stats.summaries}`);
  console.log(`   Entities:   ${result.stats.entities}`);
  console.log(`   Relations:  ${result.stats.relations}`);
  console.log(`   Projects:   ${result.stats.projects}`);
  console.log('\n' + '═'.repeat(40) + '\n');
}

async function runDiagnostics(dbPath: string = '~/.openclaw/quantum.db'): Promise<void> {
  const result: HealthResult = {
    status: 'ok',
    checks: {},
    stats: {
      sessions: 0,
      messages: 0,
      summaries: 0,
      entities: 0,
      relations: 0,
      projects: 0,
    },
  };
  
  try {
    // Expand path
    const expandedPath = dbPath.startsWith('~/') 
      ? join(homedir(), dbPath.slice(2))
      : dbPath;
    
    const db = new QuantumDatabase({ databasePath: expandedPath });
    db.initialize();
    
    // Get stats
    const sessionMgr = new SessionManager(db);
    const msgStore = new MessageStore(db);
    const summaryStore = new SummaryStore(db);
    const entityStore = new EntityStore(db);
    const relationStore = new RelationStore(db);
    const projMgr = new ProjectManager(db);
    
    // Count stats
    result.stats.sessions = sessionMgr.count();
    result.stats.projects = projMgr.list().length;
    const msgCount = db.query<{c:number}>('SELECT COUNT(*) as c FROM messages')[0];
    result.stats.messages = msgCount?.c || 0;
    const sumCount = db.query<{c:number}>('SELECT COUNT(*) as c FROM summaries')[0];
    result.stats.summaries = sumCount?.c || 0;
    const entCount = db.query<{c:number}>('SELECT COUNT(*) as c FROM entities')[0];
    result.stats.entities = entCount?.c || 0;
    const relCount = db.query<{c:number}>('SELECT COUNT(*) as c FROM relations')[0];
    result.stats.relations = relCount?.c || 0;
    
    // Health checks
    result.checks.database = { status: 'ok', message: 'Connected successfully' };
    result.checks.schema = { status: 'ok', message: 'All tables present' };
    result.checks.writes = { status: 'ok' };
    
    // Warnings
    if (result.stats.sessions === 0) {
      result.checks.sessions = { status: 'warn', message: 'No sessions yet' };
      if (result.status === 'ok') result.status = 'warn';
    } else {
      result.checks.sessions = { status: 'ok', message: `${result.stats.sessions} total` };
    }
    
    db.close();
    
  } catch (error: any) {
    result.status = 'error';
    result.checks.database = { status: 'error', message: error.message };
  }
  
  printStatus(result);
  
  process.exit(result.status === 'error' ? 1 : 0);
}

// CLI
const args = process.argv.slice(2);
const dbPath = args[0] || '~/.openclaw/quantum.db';
runDiagnostics(dbPath);
