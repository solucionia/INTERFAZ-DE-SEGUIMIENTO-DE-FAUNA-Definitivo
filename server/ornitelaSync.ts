import * as cheerio from "cheerio";
import { log } from "./index";

const ORNITELA_TIMEOUT_MS = 60000;
const DOWNLOAD_DELAY_MS = 2000;

export interface OrnitelaDevice {
  name: string;
  serial: string;
  status: string;
  lastGPRS: string;
  imei: string;
}

export interface OrnitelaSession {
  cookie: string;
}

export class OrnitelaSyncError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "OrnitelaSyncError";
    this.statusCode = statusCode;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = ORNITELA_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (e: any) {
    if (e.name === "AbortError") {
      throw new OrnitelaSyncError(
        "El panel de Ornitela no respondió a tiempo.",
        408
      );
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export class OrnitelaSync {
  async login(
    panelUrl: string,
    username: string,
    password: string
  ): Promise<OrnitelaSession> {
    const postUrl = `${panelUrl}/post.php`;

    const formData = new URLSearchParams();
    formData.append("username", username);
    formData.append("password", password);
    formData.append("login", "Login");
    formData.append("resx", "800");
    formData.append("resy", "1716");
    formData.append("resax", "2008");
    formData.append("resay", "4308");
    formData.append("reso", "-90");

    log(`Ornitela login POST a ${postUrl}`, "ornitela");

    const res = await fetchWithTimeout(postUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
      redirect: "manual",
    });

    const setCookieHeaders = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") || "").split(",").filter(Boolean);

    let sessionCookie = "";
    for (const cookieStr of setCookieHeaders) {
      const match = cookieStr.match(/glo_sessid=([^;]+)/);
      if (match) {
        sessionCookie = `glo_sessid=${match[1]}`;
        break;
      }
    }

    if (!sessionCookie) {
      log(
        `Ornitela login falló: no se encontró cookie glo_sessid. Status: ${res.status}`,
        "ornitela"
      );
      throw new OrnitelaSyncError(
        "Login a Ornitela falló: credenciales inválidas o respuesta inesperada.",
        401
      );
    }

    log(`Ornitela login exitoso, cookie obtenida`, "ornitela");
    return { cookie: sessionCookie };
  }

  async getDeviceList(
    panelUrl: string,
    session: OrnitelaSession
  ): Promise<OrnitelaDevice[]> {
    log(`Ornitela obteniendo lista de dispositivos de ${panelUrl}`, "ornitela");

    const res = await fetchWithTimeout(panelUrl, {
      method: "GET",
      headers: {
        Cookie: session.cookie,
      },
    });

    if (!res.ok) {
      throw new OrnitelaSyncError(
        `Error al obtener la página principal de Ornitela: ${res.status}`,
        res.status
      );
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const devices: OrnitelaDevice[] = [];

    $("table tr").each((_index, row) => {
      const cells = $(row).find("td");
      if (cells.length < 3) return;

      const texts: string[] = [];
      cells.each((_i, cell) => {
        texts.push($(cell).text().trim());
      });

      let imei = "";
      cells.each((_i, cell) => {
        const cellHtml = $(cell).html() || "";
        const imeiMatch = cellHtml.match(/dl(\d{10,20})cc/);
        if (imeiMatch) {
          imei = imeiMatch[1];
        }

        const inputEl = $(cell).find("input[name*='dl']");
        if (inputEl.length > 0) {
          const nameAttr = inputEl.attr("name") || "";
          const inputImeiMatch = nameAttr.match(/dl(\d{10,20})cc/);
          if (inputImeiMatch) {
            imei = inputImeiMatch[1];
          }
        }
      });

      if (!imei) {
        const rowHtml = $(row).html() || "";
        const rowImeiMatch = rowHtml.match(/dl(\d{10,20})cc/);
        if (rowImeiMatch) {
          imei = rowImeiMatch[1];
        }
      }

      if (imei) {
        devices.push({
          name: texts[0] || "",
          serial: texts[1] || "",
          status: texts[2] || "",
          lastGPRS: texts[3] || "",
          imei,
        });
      }
    });

    log(
      `Ornitela encontrados ${devices.length} dispositivos`,
      "ornitela"
    );
    return devices;
  }

  async downloadCSV(
    panelUrl: string,
    session: OrnitelaSession,
    imei: string,
    fromDate: string,
    toDate: string
  ): Promise<string> {
    const postUrl = `${panelUrl}/post.php`;

    const deviceFieldName = `dl${imei}cc`;

    const formData = new URLSearchParams();
    formData.append(deviceFieldName, "");
    formData.append("dnlselpm", "25p");
    formData.append("dnlfromdt", fromDate);
    formData.append("dnltodt", toDate);
    formData.append("dnlselkk", "1");
    formData.append("dnlselcc", "0");

    log(
      `Ornitela descargando CSV para IMEI ${imei}, rango ${fromDate} - ${toDate}`,
      "ornitela"
    );

    const res = await fetchWithTimeout(postUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: session.cookie,
      },
      body: formData.toString(),
    });

    if (!res.ok) {
      throw new OrnitelaSyncError(
        `Error al descargar CSV de Ornitela para IMEI ${imei}: ${res.status}`,
        res.status
      );
    }

    const csvContent = await res.text();
    log(
      `Ornitela CSV descargado para IMEI ${imei}: ${csvContent.length} bytes`,
      "ornitela"
    );
    return csvContent;
  }

  async downloadAllDevicesCSV(
    panelUrl: string,
    session: OrnitelaSession,
    devices: OrnitelaDevice[],
    fromDate: string,
    toDate: string
  ): Promise<{ imei: string; name: string; csv: string; error?: string }[]> {
    const results: {
      imei: string;
      name: string;
      csv: string;
      error?: string;
    }[] = [];

    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];

      if (i > 0) {
        await delay(DOWNLOAD_DELAY_MS);
      }

      try {
        const csv = await this.downloadCSV(
          panelUrl,
          session,
          device.imei,
          fromDate,
          toDate
        );
        results.push({ imei: device.imei, name: device.name, csv });
      } catch (err: any) {
        log(
          `Ornitela error descargando CSV para ${device.name} (IMEI: ${device.imei}): ${err.message}`,
          "ornitela"
        );
        results.push({
          imei: device.imei,
          name: device.name,
          csv: "",
          error: err.message,
        });
      }
    }

    return results;
  }
}

export const ornitelaSync = new OrnitelaSync();
