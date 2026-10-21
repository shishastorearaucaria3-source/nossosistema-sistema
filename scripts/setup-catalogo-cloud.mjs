#!/usr/bin/env node

// Setup de D1 + R2 para o catálogo cloud-independent
// Execute: node scripts/setup-catalogo-cloud.mjs

import { execSync } from 'node:child_process';

const WRANGLER = 'npx wrangler';

function run(cmd) {
  console.log(`> ${cmd}`);
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    if (out.trim()) console.log(out.trim());
    return out.trim();
  } catch (e) {
    console.error(`ERRO: ${e.stderr || e.message}`);
    process.exit(1);
  }
}

function extractId(output) {
  const m = output.match(/"database_id":\s*"([^"]+)"/);
  return m ? m[1] : null;
}

console.log('=== Setup Catálogo Cloud (D1 + R2) ===\n');

// 1. Criar D1
console.log('1. Criando D1 database...');
let d1Out;
try {
  d1Out = run(`${WRANGLER} d1 create catalogo-db`);
} catch {
  console.log('   D1 já existe, buscando ID...');
  d1Out = run(`${WRANGLER} d1 list`);
}
const d1Id = extractId(d1Out);
if (d1Id) {
  console.log(`   Database ID: ${d1Id}`);
  console.log(`   Atualize wrangler.jsonc: database_id = "${d1Id}"`);
}

// 2. Aplicar schema
console.log('\n2. Aplicando schema D1...');
if (d1Id) {
  run(`${WRANGLER} d1 execute catalogo-db --file=src/schema-d1.sql`);
} else {
  console.log('   SKIP: database_id não encontrado. Aplique manualmente.');
}

// 3. Criar R2 bucket
console.log('\n3. Criando R2 bucket...');
try {
  run(`${WRANGLER} r2 bucket create catalogo-imagens`);
} catch {
  console.log('   Bucket já existe.');
}

// 4. Token de sincronização é gerado automaticamente pelo servidor local
//    (catalogo-sync.token) e o segredo CATALOGO_SYNC_TOKEN do Worker é o mesmo
//    valor — publicado via `wrangler secret put` pelo administrador no deploy.

console.log('\n=== Próximos passos ===');
console.log('1. Atualize database_id no wrangler.jsonc');
console.log('2. Configure CATALOGO_SYNC_TOKEN como secret no Worker');
console.log('3. Garanta que a URL central do Worker em src/server/config-catalogo.ts aponta para o Worker publicado');
console.log('4. Execute sync: use o botão "Atualizar conexão do catálogo" (não há URL manual a preencher)');
