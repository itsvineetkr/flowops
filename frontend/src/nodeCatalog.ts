import type { Kind } from './api'

// 'image' is a text field with Docker Hub suggestions.
export type FieldType = 'text' | 'number' | 'list' | 'kv' | 'select' | 'multi' | 'image'
export type Field = {
  key: string
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  options?: string[]
  sep?: string // list separator; defaults to ","
}
export type NodeDef = {
  type: string
  label: string
  category: string
  fields: Field[]
  defaults: Record<string, unknown>
}

// Param keys must match what backend/app/generators/* read.
const command = (type: string, label: string, placeholder: string): NodeDef => ({
  type,
  label,
  category: 'Steps',
  fields: [
    { key: 'command', label: 'Command', type: 'text', required: true, placeholder },
    { key: 'name', label: 'Step name', type: 'text', placeholder: label },
  ],
  defaults: { command: '' },
})

const CATALOG: Record<Kind, NodeDef[]> = {
  dockerfile: [
    {
      type: 'from', label: 'FROM', category: 'Stage',
      fields: [
        { key: 'image', label: 'Base image', type: 'image', required: true, placeholder: 'node:20-alpine' },
        { key: 'as', label: 'Stage name (AS)', type: 'text', placeholder: 'build' },
      ],
      defaults: { image: '' },
    },
    {
      type: 'workdir', label: 'WORKDIR', category: 'Instructions',
      fields: [{ key: 'path', label: 'Path', type: 'text', required: true, placeholder: '/app' }],
      defaults: { path: '/app' },
    },
    {
      type: 'copy', label: 'COPY', category: 'Instructions',
      fields: [
        { key: 'src', label: 'Source', type: 'text', required: true, placeholder: '.' },
        { key: 'dest', label: 'Destination', type: 'text', required: true, placeholder: '.' },
        { key: 'from', label: 'From stage', type: 'text', placeholder: 'build' },
      ],
      defaults: { src: '.', dest: '.' },
    },
    {
      type: 'run', label: 'RUN', category: 'Instructions',
      fields: [{ key: 'command', label: 'Command', type: 'text', required: true, placeholder: 'npm ci' }],
      defaults: { command: '' },
    },
    {
      type: 'env', label: 'ENV', category: 'Instructions',
      fields: [
        { key: 'key', label: 'Name', type: 'text', required: true, placeholder: 'NODE_ENV' },
        { key: 'value', label: 'Value', type: 'text', required: true, placeholder: 'production' },
      ],
      defaults: {},
    },
    {
      type: 'expose', label: 'EXPOSE', category: 'Runtime',
      fields: [{ key: 'port', label: 'Port', type: 'number', required: true, placeholder: '3000' }],
      defaults: {},
    },
    {
      type: 'cmd', label: 'CMD', category: 'Runtime',
      fields: [{ key: 'args', label: 'Command', type: 'list', sep: ' ', required: true, placeholder: 'node server.js' }],
      defaults: {},
    },
  ],
  compose: [
    {
      type: 'service', label: 'Service', category: 'Services',
      fields: [
        { key: 'name', label: 'Service name', type: 'text', required: true, placeholder: 'api' },
        { key: 'image', label: 'Image', type: 'image', placeholder: 'postgres:16' },
        { key: 'build', label: 'Build context', type: 'text', placeholder: '.' },
        { key: 'ports', label: 'Ports', type: 'list', placeholder: '8000:8000, 9229:9229' },
        { key: 'environment', label: 'Environment (KEY=value per line)', type: 'kv', placeholder: 'DATABASE_URL=postgres://...' },
        { key: 'volumes', label: 'Volumes', type: 'list', placeholder: 'pgdata:/var/lib/postgresql/data' },
        { key: 'restart', label: 'Restart policy', type: 'select', options: ['', 'no', 'always', 'unless-stopped', 'on-failure'] },
      ],
      defaults: { name: 'service' },
    },
  ],
  pipeline: [
    {
      type: 'trigger', label: 'Trigger', category: 'Start',
      fields: [
        { key: 'events', label: 'Events', type: 'multi', options: ['push', 'pull_request', 'schedule', 'workflow_dispatch'] },
        { key: 'branches', label: 'Branches', type: 'list', placeholder: 'main, develop' },
        { key: 'cron', label: 'Cron (for schedule)', type: 'text', placeholder: '0 3 * * *' },
      ],
      defaults: { events: ['push', 'pull_request'], branches: ['main'] },
    },
    { type: 'checkout', label: 'Checkout', category: 'Setup', fields: [], defaults: {} },
    {
      type: 'setup_runtime', label: 'Setup runtime', category: 'Setup',
      fields: [
        { key: 'runtime', label: 'Runtime', type: 'select', required: true, options: ['node', 'python', 'java', 'go', 'dotnet', 'ruby', 'php', 'rust'] },
        { key: 'version', label: 'Version', type: 'text', required: true, placeholder: '20' },
        { key: 'cache', label: 'Dependency cache', type: 'text', placeholder: 'npm / pip / maven' },
      ],
      defaults: { runtime: 'node', version: '20' },
    },
    command('install', 'Install deps', 'npm ci'),
    command('lint', 'Lint', 'npm run lint'),
    command('test', 'Test', 'npm test'),
    command('build', 'Build', 'npm run build'),
    {
      type: 'docker_build', label: 'Docker build', category: 'Docker',
      fields: [
        { key: 'image', label: 'Image tag', type: 'text', required: true, placeholder: 'myapp:latest' },
        { key: 'context', label: 'Context', type: 'text', placeholder: '.' },
      ],
      defaults: { image: '' },
    },
    {
      type: 'docker_push', label: 'Docker push', category: 'Docker',
      fields: [
        { key: 'registry', label: 'Registry', type: 'select', options: ['dockerhub', 'ghcr'] },
        { key: 'image', label: 'Image tag', type: 'text', required: true, placeholder: 'user/myapp:latest or ghcr.io/owner/app:latest' },
        { key: 'context', label: 'Context', type: 'text', placeholder: '.' },
      ],
      defaults: { registry: 'dockerhub', image: '' },
    },
    { ...command('deploy', 'Deploy', './deploy.sh'), category: 'Release' },
    { ...command('notify', 'Notify', 'curl -X POST $WEBHOOK'), category: 'Release' },
  ],
}

export const defsFor = (kind: Kind) => CATALOG[kind]
export const defOf = (kind: Kind, type: string) => CATALOG[kind].find((d) => d.type === type)

export const CATEGORY_COLOR: Record<string, string> = {
  Start: 'border-emerald-400/45 bg-emerald-400/10 hover:bg-emerald-400/15',
  Setup: 'border-sky-400/45 bg-sky-400/10 hover:bg-sky-400/15',
  Steps: 'border-indigo-400/45 bg-indigo-400/10 hover:bg-indigo-400/15',
  Docker: 'border-cyan-400/45 bg-cyan-400/10 hover:bg-cyan-400/15',
  Release: 'border-amber-400/45 bg-amber-400/10 hover:bg-amber-400/15',
  Stage: 'border-emerald-400/45 bg-emerald-400/10 hover:bg-emerald-400/15',
  Instructions: 'border-indigo-400/45 bg-indigo-400/10 hover:bg-indigo-400/15',
  Runtime: 'border-amber-400/45 bg-amber-400/10 hover:bg-amber-400/15',
  Services: 'border-cyan-400/45 bg-cyan-400/10 hover:bg-cyan-400/15',
}
