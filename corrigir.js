import fs from "fs";
import path from "path";
import Papa from "papaparse";

// Caminho do CSV original
const caminhoOriginal = path.resolve("./public", "ceps.csv");

// Lê o conteúdo original
const csvOriginal = fs.readFileSync(caminhoOriginal, "utf8");

// Converte para objeto
const { data, errors, meta } = Papa.parse(csvOriginal, {
  header: true,
  skipEmptyLines: true,
});

// Corrige campos principais
const corrigido = data.map(row => {
  return {
    ...row,
    REPRESENTANTE: row.REPRESENTANTE?.trim(),
    ESTADO: row.ESTADO?.trim().toUpperCase(),
    CIDADE: row.CIDADE?.trim(),
    CELULAR: row.CELULAR?.replace(/\D/g, ""), // opcional: limpar celular
  };
});

// Converte de volta para CSV
const csvCorrigido = Papa.unparse(corrigido);

// Salva novo arquivo
const caminhoCorrigido = path.resolve("./public", "ceps_corrigido.csv");
fs.writeFileSync(caminhoCorrigido, csvCorrigido, "utf8");

console.log("✅ CSV corrigido salvo como ceps_corrigido.csv");
