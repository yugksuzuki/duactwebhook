import fs from "fs";
import path from "path";
import axios from "axios";
import Papa from "papaparse";

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lat2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function carregarRepresentantes() {
  const filePath = path.resolve("./public", "cepsr.csv");
  const csvContent = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse(csvContent, { header: true });

  return parsed.data
    .filter(row => row.Latitude && row.Longitude)
    .map(row => ({
      nome: row.REPRESENTANTE,
      cidade: row.CIDADE,
      estado: row.ESTADO,
      celular: row["CELULAR"] || row["CELULAR 2"] || "",
      lat: parseFloat(row.Latitude),
      lon: parseFloat(row.Longitude),
    }));
}

async function geocodificarEndereco(endereco) {
  const OPENCAGE_KEY = "24d5173c43b74f549f4c6f5b263d52b3";
  const geoURL = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(endereco)}&countrycode=br&key=${OPENCAGE_KEY}`;
  const geoResp = await axios.get(geoURL);
  return geoResp?.data?.results?.[0]?.geometry;
}

async function tentarVariacoesDeCep(cepBase) {
  const prefixo = cepBase.slice(0, 5);
  const tentativas = [cepBase];

  for (let i = 1; i <= 99; i++) {
    const sufixoAlternativo = i.toString().padStart(3, "0");
    tentativas.push(`${prefixo}${sufixoAlternativo}`);
  }

  for (const cep of tentativas) {
    try {
      const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`);
      if (!data.erro) {
        console.log(`[DEBUG] CEP usado com sucesso: ${cep}`);
        return { cep, dados: data };
      }
    } catch {
      continue;
    }
  }

  return null;
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
  let coordenadas = null;

  try {
    let tentativa = await tentarVariacoesDeCep(cepOriginal);

    if (!tentativa) {
      const geoFallback = await geocodificarEndereco(`${cepOriginal}, Brasil`);
      if (!geoFallback) {
        return res.status(200).json({
          reply: "❌ Não foi possível localizar sua região geográfica. Tente novamente mais tarde.",
        });
      }

      dados = {
        localidade: "",
        uf: "",
        logradouro: "",
      };
      endereco = `${cepOriginal}, Brasil`;
      coordenadas = geoFallback;
    } else {
      dados = tentativa.dados;
      const cidade = (dados.localidade || "").trim();
      const estado = dados.uf;
      const logradouro = dados.logradouro?.trim();

      endereco = logradouro
        ? `${logradouro}, ${cidade} - ${estado}, Brasil`
        : `${cidade} - ${estado}, Brasil`;
    }
  } catch (err) {
    return res.status(200).json({
      reply: "❌ Não foi possível consultar o CEP informado. Verifique se está correto.",
    });
  }

  try {
    if (!coordenadas) {
      coordenadas = await geocodificarEndereco(endereco);
    }

    if (!dados.uf && coordenadas) {
      const reverse = await axios.get(
        `https://api.opencagedata.com/geocode/v1/json?q=${coordenadas.lat}+${coordenadas.lng}&key=24d5173c43b74f549f4c6f5b263d52b3&language=pt`
      );
      const componente = reverse.data?.results?.[0]?.components;
      if (componente) {
        dados.localidade = componente.city || componente.town || componente.village || "";
        dados.uf = componente.state_code || "";
      }
    }

    if (!coordenadas) {
      throw new Error("Sem resultado do OpenCage");
    }
  } catch (err) {
    return res.status(200).json({
      reply: "❌ Não foi possível localizar sua região geográfica. Tente novamente mais tarde.",
    });
  }

  const latCliente = coordenadas.lat;
  const lonCliente = coordenadas.lng;
  const estado = dados.uf;
  const cidadeUsuario = (dados.localidade || "").trim().toLowerCase();

  // ⬇️ Coloque as regras aqui

// Regras fixas por estado
if (["RJ", "ES"].includes(estado)) {
  return res.status(200).json({
    reply: `✅ Representante para todo o estado do ${estado}:\n\n📍 *Rafa*\n📞 WhatsApp: https://wa.me/5522992417676`,
  });
}

if (estado === "MG") {
  return res.status(200).json({
    reply: `✅ Representante para Minas Gerais:\n\n📍 *Luiz Carlos*\n📞 WhatsApp: https://wa.me/5531996036765`,
  });
}

if (["MS", "MT"].includes(estado)) {
  return res.status(200).json({
    reply: `✅ Representante para ${estado}:\n\n📍 *Rodolfo*\n📞 WhatsApp: https://wa.me/5567993044747`,
  });
}

if (["BA", "SE", "AL", "PE", "PB", "RN", "CE", "PI"].includes(estado)) {
  return res.status(200).json({
    reply: `✅ Representante para a região Nordeste (${estado}):\n\n📍 *Everson*\n📞 WhatsApp: https://wa.me/5547985418374`,
  });
}

if (["PA", "AM", "AC", "RO", "RR", "TO", "AP"].includes(estado)) {
  return res.status(200).json({
    reply: `✅ Representante para a região Norte (${estado}):\n\n📍 *Everson*\n📞 WhatsApp: https://wa.me/5547985418374`,
  });
}

// São Paulo
if (estado === "SP") {
  const cidadesLitoraisSP = [
    "Santos", "Guarujá", "São Vicente", "Praia Grande", "Mongaguá", "Itanhaém", "Peruíbe",
    "Bertioga", "Caraguatatuba", "São Sebastião", "Ilhabela", "Ubatuba", "Cubatão", "Cananéia",
    "Iguape", "Ilha Comprida", "Jacupiranga", "Registro", "Pariquera-Açu", "Juquiá", "Miracatu",
    "Pedro de Toledo", "Itariri", "Sete Barras", "Eldorado"
  ];
  
  if (cidadesLitoraisSP.includes(cidade)) {
    return res.status(200).json({
      reply: `✅ Representante para o litoral de São Paulo:\n\n📍 *Marcelo*\n📞 WhatsApp: https://wa.me/5519996718937`,
    });
  } else {
    return res.status(200).json({
      reply: `✅ Representante para o interior de São Paulo:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/5547991710236`,
    });
  }
}

// Paraná
if (estado === "PR") {
  const distanciaLoanda = haversine(lat, lon, -23.0862, -53.0697); // Coordenadas de Loanda
  if (distanciaLoanda <= 100) {
    return res.status(200).json({
      reply: `✅ Representante para a região de Loanda (PR):\n\n📍 *Luiz Carlos*\n📞 WhatsApp: https://wa.me/5531996036765`,
    });
  } else {
    return res.status(200).json({
      reply: `✅ Representante para o Paraná:\n\n📍 *Everson*\n📞 WhatsApp: https://wa.me/5547985418374`,
    });
  }
}

// Santa Catarina
if (estado === "SC") {
  if (cidade === "Chapecó") {
    return res.status(200).json({
      reply: `✅ Representante para Chapecó e região Oeste:\n\n📍 *Everson*\n📞 WhatsApp: https://wa.me/5547985418374`,
    });
  } else if (
    ["Joinville", "Blumenau", "Itajaí", "Jaraguá do Sul", "Brusque", "São Bento do Sul", "Rio do Sul"].includes(cidade)
  ) {
    return res.status(200).json({
      reply: `✅ Representante para a região Norte/Centro de SC:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/5547991710236`,
    });
  } else {
    return res.status(200).json({
      reply: `✅ Representante para o litoral e sul de SC:\n\n📍 *Everson*\n📞 WhatsApp: https://wa.me/5547985418374`,
    });
  }
}

// Rio Grande do Sul
if (estado === "RS") {
  const distanciaRioGrande = haversine(lat, lon, -32.0339, -52.0986); // Coordenadas de Rio Grande
  const cidadesSerraRS = ["Caxias do Sul", "Gramado", "Canela", "Bento Gonçalves", "Farroupilha", "Nova Petrópolis"];

  if (cidadesSerraRS.includes(cidade) || cidade === "Porto Alegre") {
    return res.status(200).json({
      reply: `✅ Representante para Porto Alegre e Serra Gaúcha:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/5547991710236`,
    });
  } else if (distanciaRioGrande <= 150) {
    return res.status(200).json({
      reply: `✅ Representante para a região sul e litoral do RS:\n\n📍 *Everson*\n📞 WhatsApp: https://wa.me/5547985418374`,
    });
  } else {
    return res.status(200).json({
      reply: `✅ Representante para o interior do Rio Grande do Sul:\n\n📍 *Neilson*\n📞 WhatsApp: https://wa.me/5547991710236`,
    });
  }
}

// Fallback (caso nenhuma das regras acima seja satisfeita)
return res.status(200).json({
  reply: `✅ Representante disponível para sua região:\n\n📍 *Everson*\n📞 WhatsApp: https://wa.me/5547985418374`,
});

  //fim regras

 let lista = carregarRepresentantes().filter(rep => rep.estado === estado);

// Se não encontrar ninguém no estado, usa todos os representantes (modo fallback)
if (lista.length === 0) {
  console.log(`[INFO] Nenhum representante no estado ${estado}, buscando geral`);
  lista = carregarRepresentantes();
}

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
