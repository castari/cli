#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { whoamiCommand } from './commands/whoami.js';
import { apikeyCommand } from './commands/apikey.js';
import { agentsCommand } from './commands/agents.js';
import { deployCommand } from './commands/deploy.js';
import { stopCommand } from './commands/stop.js';
import { invokeCommand } from './commands/invoke.js';
import { secretsCommand } from './commands/secrets.js';
import { usageCommand } from './commands/usage.js';
import { initCommand } from './commands/init.js';
import { bucketsCommand } from './commands/buckets.js';
import { mountsCommand } from './commands/mounts.js';
import { filesCommand } from './commands/files.js';
import { sessionsCommand } from './commands/sessions.js';
import { invocationsCommand } from './commands/invocations.js';
import { registerEvalCommand, registerEvalInitCommand } from './commands/eval.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('cast')
  .description('Castari CLI - Deploy AI agents with one command')
  .version(version);

// Auth commands
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);
program.addCommand(apikeyCommand);

// Agent management
program.addCommand(agentsCommand);

// Deployment
program.addCommand(deployCommand);
program.addCommand(stopCommand);

// Invocation
program.addCommand(invokeCommand);

// Secrets
program.addCommand(secretsCommand);

// Usage
program.addCommand(usageCommand);

// Project initialization
program.addCommand(initCommand);

// Storage management
program.addCommand(bucketsCommand);
program.addCommand(mountsCommand);
program.addCommand(filesCommand);

// Sessions & Invocations
program.addCommand(sessionsCommand);
program.addCommand(invocationsCommand);

// Eval
registerEvalCommand(program);
registerEvalInitCommand(program);

// Parse arguments
program.parse();
