import axios from "axios";
import fs from "fs";

const endpoint = "https://duactwebhook.vercel.app/api/teste-webhook.js";
const delay = 5000;
const timeout = 10000;

const ceps = [
  "98900-000", "88704-410", "96200-600", "88210-000",
  "93800-140", "92480-000", "95250-000", "60510-138", "60135-041", "60710-830",
  "59611-140", "92708-070", "38120-000", "35570-000", "38240-000", "37570-000",
  "38140-000", "35179-000", "38480-000", "38073-000", "79780-000", "14780-536",
  "14403-430", "14790-000", "15700-000", "15371-176", "14750-000", "15045-334",
  "95300-000", "95585-000", "95577-000", "95748-000", "95535-000", "95560-000",
  "88900-000", "88955-000", "88820-000", "95480-000", "88845-000", "88801-000",
  "88850-000", "88950-000", "88920-000", "88980-000", "88990-000", "88965-000",
  "88960-000", "88940-000", "88930-000", "28900-001", "28020-740", "28010-076",
  "28893-812", "28909-490", "29122-030", "28956-810", "28083-101", "27600-000",
  "91786-299", "90610-001", "6454-070", "11680-000", "11660-000", "11600-000",
  "11630-000", "11250-000", "11010-000", "11410-000", "11310-000", "11500-000",
  "11700-000", "11730-000", "11740-000", "11750-000", "11920-000", "11925-000",
  "11990-000", "79800-000", "79000-000"
];

const resultados = [];

function getTimestamp() {
  return new Date().toISOString();
}

async function testarCEPs() {
  for (const cep of ceps) {
    console.log(`\n🔎 Iniciando teste para CEP: ${cep}`);
    const payload = { variables: { CEP_usuario: cep } };
    const inicio = Date.now();
    let resultado = { cep, inicio: getTimestamp(), payload };

    try {
      const response = await axios.post(endpoint, payload, { timeout });

      const fim = Date.now();
      const duracao = fim - inicio;

      const primeiraLinha = response.data.reply?.split("\n")[0];

      resultado.status = "sucesso";
      resultado.fim = getTimestamp();
      resultado.tempo_ms = duracao;
      resultado.http_status = response.status;
      resultado.primeira_linha = primeiraLinha;
      resultado.resposta_completa = response.data.reply;

      console.log(`✅ [${cep}] Finalizado em ${duracao}ms`);
      console.log(`📍 Primeira linha: ${primeiraLinha}`);
      console.log(`📩 Resposta completa:\n${response.data.reply}`);
    } catch (err) {
      const fim = Date.now();
      const duracao = fim - inicio;

      resultado.status = "erro";
      resultado.fim = getTimestamp();
      resultado.tempo_ms = duracao;
      resultado.mensagem = err.message;
      resultado.codigo = err.code;
      resultado.stack = err.stack;

      if (err.response) {
        resultado.http_status = err.response.status;
        resultado.resposta_erro = err.response.data;
        console.log(`❌ [${cep}] ERRO HTTP ${err.response.status} (${duracao}ms)`);
        console.log(`📩 Conteúdo do erro:`, err.response.data);
      } else {
        console.log(`❌ [${cep}] TIMEOUT ou erro de rede após ${duracao}ms`);
        console.log(`📛 Erro: ${err.message}`);
      }
    }

    resultados.push(resultado);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // 📊 Resumo
  const total = resultados.length;
  const erros = resultados.filter(r => r.status === "erro").length;
  const sucesso = total - erros;

  console.log("\n📈 RESUMO FINAL");
  console.log(`🔢 Total testados: ${total}`);
  console.log(`✅ Sucessos: ${sucesso}`);
  console.log(`❌ Erros: ${erros}`);

  fs.writeFileSync("resultado-testewebhook.json", JSON.stringify(resultados, null, 2), "utf-8");
  console.log("📄 Arquivo 'resultado-testewebhook.json' salvo.");
}

testarCEPs();
