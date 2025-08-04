import fs from "fs";
import path from "path";
import axios from "axios";
import Papa from "papaparse";

function normalize(str) {
  return str?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}


function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function carregarRepresentantes() {
  const arquivos = ["cepsr.csv", "ceps2r.csv"];
  const representantes = [];

  for (const nomeArquivo of arquivos) {
    const filePath = path.resolve("./public", nomeArquivo);
    const csvContent = fs.readFileSync(filePath, "utf8");

    const isSemCabecalho = nomeArquivo === "ceps2r.csv";
    const parsed = Papa.parse(csvContent, {
      header: !isSemCabecalho, // ceps2r.csv não tem cabeçalho
      skipEmptyLines: true,
    });

    const linhas = isSemCabecalho
      ? parsed.data.map(row => ({
          nome: row[0],
          cidade: row[3],
          estado: row[2],
          celular: row[6]?.toString().replace(/\D/g, ""),
          lat: parseFloat(row[7]),
          lon: parseFloat(row[8]),
        }))
      : parsed.data.map(row => ({
          nome: row.REPRESENTANTE || row.LOJA || Object.values(row)[0],
          cidade: row.CIDADE,
          estado: row.ESTADO,
          celular: row["CELULAR"] || row["CELULAR 2"] || "",
          lat: parseFloat(row.Latitude),
          lon: parseFloat(row.Longitude),
        }));

    representantes.push(
      ...linhas.filter(r => r.nome && r.estado && !isNaN(r.lat) && !isNaN(r.lon))
    );
  }

  return representantes;
}


async function geocodificarEndereco(endereco) {
  const OPENCAGE_KEY = "24d5173c43b74f549f4c6f5b263d52b3";
  const geoURL = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(endereco)}&countrycode=br&key=${OPENCAGE_KEY}`;
  const geoResp = await axios.get(geoURL);
  return geoResp?.data?.results?.[0]?.geometry;
}

async function tentarVariacoesDeCep(cepBase) {
  const prefixoBase = cepBase.slice(0, 5);
  const tentativas = [];

  console.time("[FASE 1] Tempo para sufixos 001 a 020");

  // 🔁 Fase 1: apenas 20 sufixos de 001 a 020
  for (let i = 1; i <= 20; i++) {
    const sufixo = i.toString().padStart(3, "0"); 
    tentativas.push({ cep: `${prefixoBase}${sufixo}`, fase: "FASE 1" });
  }

  console.timeEnd("[FASE 1] Tempo para sufixos 001 a 020");

  console.time("[FASE 2] Tempo para prefixos 94910-000 a 94990-000");

  // 🔁 Fase 2: variação no penúltimo dígito (94910-000, 94920-000, ..., 94990-000)
  const penultimos = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const n of penultimos) {
    const novoPrefixo = `${prefixoBase.slice(0, 3)}${n}0`;
    tentativas.push({ cep: `${novoPrefixo}000`, fase: "FASE 2" });
  }

  console.timeEnd("[FASE 2] Tempo para prefixos 94910-000 a 94990-000");

  console.time("🧠 Tempo total para busca de CEP válido");

  // 🔎 Tenta os CEPs gerados, um por um
  for (const tentativa of tentativas) {
    const { cep, fase } = tentativa;
    try {
      const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`);
      if (!data.erro) {
        console.log(`[✅ ${fase}] CEP encontrado: ${cep}`);
        console.timeEnd("🧠 Tempo total para busca de CEP válido");
        return { cep, dados: data };
      } else {
        console.log(`[❌ ${fase}] CEP ${cep} inválido.`);
      }
    } catch (err) {
      console.warn(`[ERRO ${fase}] Falha ao consultar CEP ${cep}: ${err.message}`);
      continue;
    }
  }

  console.timeEnd("🧠 Tempo total para busca de CEP válido");
  return null; // Nenhum CEP válido encontrado
}


export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ reply: "❌ Método não permitido. Use POST." });
  }

  const { variables } = req.body;
  const cepOriginal = variables?.CEP_usuario?.replace(/\D/g, "");

  if (!cepOriginal || cepOriginal.length !== 8) {
    return res.status(200).json({ reply: "❌ CEP inválido ou incompleto. Tente novamente." });
  }

  let endereco = null;
  let dados = null;

  try {
    const tentativa = await tentarVariacoesDeCep(cepOriginal);
    if (!tentativa) throw new Error("CEP inválido");

    dados = tentativa.dados;
    const cidade = (dados.localidade || "").trim();
    const estado = dados.uf;
    const logradouro = dados.logradouro?.trim();

    endereco = logradouro
      ? `${logradouro}, ${cidade} - ${estado}, Brasil`
      : `${cidade} - ${estado}, Brasil`;
  } catch (err) {
    return res.status(200).json({
      reply: "❌ Não foi possível consultar o CEP informado. Verifique se está correto.",
    });
  }

  let coordenadas = null;
  try {
    coordenadas = await geocodificarEndereco(endereco);

    const cidade = (dados.localidade || "").trim();
    const estado = dados.uf;

    if (!coordenadas && cidade && estado) {
      console.log(`[DEBUG] Geocodificação fallback com cidade: ${cidade}, estado: ${estado}`);
      coordenadas = await geocodificarEndereco(`${cidade} - ${estado}, Brasil`);
    }

    if (!coordenadas) throw new Error("Sem resultado do OpenCage");
  } catch (err) {
    return res.status(200).json({
      reply: "❌ Não foi possível localizar sua região geográfica. Tente novamente mais tarde.",
    });
  }

  const latCliente = coordenadas.lat;
  const lonCliente = coordenadas.lng;
  const estado = dados.uf;
 const cidadeUsuario = normalize(dados.localidade || "");


  // 📌 Regras personalizadas:
// 🎯 Regras específicas para o estado do RS

// Rio Grande (e 50km ao redor)
if (estado === "RS" && cidadeUsuario === "rio grande") {
  const dioneiLat = -32.035;
  const dioneiLon = -52.099;
  const dist = haversine(latCliente, lonCliente, dioneiLat, dioneiLon);
  if (dist <= 50) {
    return res.status(200).json({
      reply: `✅ Representante para Rio Grande (RS) e 50km ao redor:\n\n📍 *Dionei*\n📞 WhatsApp: https://wa.me/53532910789\n📏 Distância: ${dist.toFixed(1)} km`,
    });
  }
}

// Viamão (e 100km ao redor de Porto Alegre)
if (estado === "RS" && cidadeUsuario === "viamão") {
  const adrianoLat = -30.0277;
  const adrianoLon = -51.2287;
  const dist = haversine(latCliente, lonCliente, adrianoLat, adrianoLon);
  if (dist <= 100) {
    return res.status(200).json({
      reply: `✅ Representante para Viamão (RS) e 100km ao redor:\n\n📍 *Adriano*\n📞 WhatsApp: https://wa.me/5551991089339\n📏 Distância: ${dist.toFixed(1)} km`,
    });
  }
}

// Litoral Gaúcho
if (estado === "RS" && [
  "torres", "tramandaí", "terra de areia", "arroio do sal", 
  "são joão do sul", "morrinhos do sul", "capão da canoa",
  "cidreira", "xangri-lá", "atlântida", "imbé", "balneário pinhal"
].includes(cidadeUsuario)) {
  return res.status(200).json({
    reply: `✅ Representante para o Litoral Gaúcho:\n\n📍 *Daniel*\n📞 WhatsApp: https://wa.me/555199987333`,
  });
}

// Região Metropolitana de Porto Alegre e Serra
if (estado === "RS" && [
  "porto alegre", "canoas", "sapucaia do sul", "cachoeirinha",
  "gravataí", "esteio", "nova santa rita", "alvorada", "guaíba"
].includes(cidadeUsuario)) {
  return res.status(200).json({
    reply: `✅ Representante para Região Metropolitana de Porto Alegre e Serra Gaúcha:\n\n📍 *Adriano e Reginaldo*\n📞 WhatsApp: https://wa.me/5551991089339`,
  });
}

// Oeste Gaúcho (e parte do Oeste Catarinense)
if (
  (estado === "RS" && [
    "santa rosa", "ijui", "cruz alta", "são luiz gonzaga",
    "santo ângelo", "passo fundo", "santa maria", "alegrete", "uruguaiana"
  ].includes(cidadeUsuario)) ||
  (estado === "SC" && [
    "chapecó", "palmitos", "pinhalzinho", "são miguel do oeste"
  ].includes(cidadeUsuario))
) {
  return res.status(200).json({
    reply: `✅ Representante para Oeste Gaúcho e Extremo Oeste Catarinense:\n\n📍 *Cristian (Andre)*\n📞 WhatsApp: https://wa.me/555984491079`,
  });
}

  if (["RJ", "ES"].includes(estado)) {
    return res.status(200).json({
      reply: `✅ Representante para todo o estado do ${estado}:\n\n📍 *Rafa*\n📞 WhatsApp: https://wa.me/5522992417676`,
    });
  }

  if (estado === "MG") {
    return res.status(200).json({
      reply: `✅ Representante para Minas Gerais:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/5516999774274`,
    });
  }

  if (estado === "PR") {
    const distLoanda = haversine(latCliente, lonCliente, -22.9297, -53.1366);
    const cidadesOeste = ["toledo", "cascavel", "foz do iguaçu", "medianeira", "marechal cândido rondon"];
    if (distLoanda <= 200 || cidadesOeste.includes(cidadeUsuario)) {
      return res.status(200).json({
        reply: `✅ Representante para raio de 200km a partir de Loanda (PR) e Oeste do PR:\n\n📍 *Mela*\n📞 WhatsApp: https://wa.me/5544991254963`,
      });
    }
    return res.status(200).json({
      reply: `✅ Representante para Curitiba e demais regiões do Paraná:\n\n📍 *Fabrício*\n📞 WhatsApp: https://wa.me/554788541414`,
    });
  }

  if (estado === "SC" && ["blumenau", "brusque"].includes(cidadeUsuario)) {
    return res.status(200).json({
      reply: `✅ Representante para Blumenau, Brusque e região:\n\n📍 *Alan*\n📞 WhatsApp: https://wa.me/554799638565`,
    });
  }

  if (estado === "SC" && ["imbituba", "garopaba", "laguna", "tubarão"].includes(cidadeUsuario)) {
    return res.status(200).json({
      reply: `✅ Representante para o Litoral Sul de SC:\n\n📍 *Peterson*\n📞 WhatsApp: https://wa.me/554899658600`,
    });
  }

  if (estado === "SC" && ["balneário camboriú", "itajai", "navegantes", "penha", "itapema", "porto belo", "bombinhas"].includes(cidadeUsuario)) {
    return res.status(200).json({
      reply: `✅ Representante para o Litoral Centro-Norte de SC:\n\n📍 *Diego*\n📞 WhatsApp: https://wa.me/554898445939`,
    });
  }

  if (estado === "SP") {
    const litoralSP = [
      "santos", "são vicente", "guarujá", "praia grande", "cubatão", "bertioga",
      "caraguatatuba", "ubatuba", "ilhabela", "mongaguá", "itanhaém", "peruíbe"
    ];

    const interiorSP = [
      "barretos", "franca", "ribeirão preto", "guaira", "batatais", "são joaquim da barra",
      "sertãozinho", "bebedouro", "orlândia", "altinópolis", "jardinópolis"
    ];

    const oesteSP = [
      "santo anastácio", "presidente prudente", "presidente epitácio", "dracena",
      "teodoro sampaio", "mirante do paranapanema"
    ];

    if (litoralSP.includes(cidadeUsuario)) {
      return res.status(200).json({
        reply: `✅ Representante para o Litoral Paulista:\n\n📍 *Marcelo*\n📞 WhatsApp: https://wa.me/5516997774274`
      });
    }

    if (interiorSP.includes(cidadeUsuario)) {
      return res.status(200).json({
        reply: `✅ Representante para o Interior de São Paulo:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/55179981233263`
      });
    }

    if (oesteSP.includes(cidadeUsuario)) {
      return res.status(200).json({
        reply: `✅ Representante para o Oeste Paulista:\n\n📍 *Aguinaldo*\n📞 WhatsApp: https://wa.me/5518996653510`
      });
    }

    return res.status(200).json({
      reply: `✅ Representante para São Paulo:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/55179981233263`
    });
  }

// 🌎 Regras para o Nordeste

// Piauí (apenas Teresina)
if (estado === "PI" && cidadeUsuario === "teresina") {
  return res.status(200).json({
    reply: `✅ Representante para Teresina (PI):\n\n📍 *Nonato*\n📞 WhatsApp: https://wa.me/5586998492624`,
  });
}

// Ceará e Rio Grande do Norte (inteiros)
if (["CE", "RN"].includes(estado)) {
  return res.status(200).json({
    reply: `✅ Representante para ${estado === "CE" ? "Ceará" : "Rio Grande do Norte"}:\n\n📍 *Júnior*\n📞 WhatsApp: https://wa.me/5585999965434`,
  });
}

// Paraíba (somente Campina Grande)
if (estado === "PB" && cidadeUsuario === "campina grande") {
  return res.status(200).json({
    reply: `✅ Representante para Campina Grande (PB):\n\n📍 *Fabrício*\n📞 WhatsApp: https://wa.me/554788541414`,
  });
}

// Pernambuco / Alagoas (apenas Maceió) / Sergipe / Bahia inteira
if (
  estado === "PE" ||
  estado === "SE" ||
  estado === "BA" ||
  (estado === "AL" && cidadeUsuario === "maceió")
) {
  return res.status(200).json({
    reply: `✅ Representante para ${estado === "PE" ? "Pernambuco" : estado === "SE" ? "Sergipe" : estado === "BA" ? "Bahia" : "Maceió (AL)"}:\n\n📍 *Fabrício*\n📞 WhatsApp: https://wa.me/554788541414`,
  });
}


  // 🔄 Fallback com cálculo de distância por Haversine
  const lista = carregarRepresentantes().filter(rep => rep.estado === estado);
  let maisProximo = null;
  let menorDistancia = Infinity;

  for (const rep of lista) {
    const dist = haversine(latCliente, lonCliente, rep.lat, rep.lon);
    if (dist < menorDistancia) {
      menorDistancia = dist;
      maisProximo = { ...rep, distancia: dist };
    }
  }

  if (maisProximo && menorDistancia <= 200) {
    console.log(`[DEBUG] CEP: ${cepOriginal} | CIDADE: ${cidadeUsuario} | ESTADO: ${estado} | DIST: ${maisProximo.distancia.toFixed(1)} km`);
    return res.status(200).json({
      reply: `✅ Representante mais próximo do CEP ${cepOriginal}:\n\n📍 *${maisProximo.nome}* – ${maisProximo.cidade}/${maisProximo.estado}\n📞 WhatsApp: https://wa.me/55${maisProximo.celular}\n📏 Distância: ${maisProximo.distancia.toFixed(1)} km`,
    });
  }

  return res.status(200).json({
    reply: `❗ Nenhum representante encontrado em até 200 km no seu estado.\n\nPara assuntos gerais, por favor entre em contato com nosso atendimento:\n☎️ *Everson*\n+55 (48) 9211-0383`,
  });
}
