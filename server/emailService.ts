import nodemailer from "nodemailer";
import type { DetectedEvent } from "@shared/schema";
import { EVENT_LABELS } from "@shared/schema";
import { log } from "./index";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

function severityLabel(severity: string): string {
  switch (severity) {
    case "critical": return "ALERTA CRITICA";
    case "high": return "ALERTA ALTA";
    case "info": return "INFORMATIVA";
    default: return severity.toUpperCase();
  }
}

function severityColor(severity: string): string {
  switch (severity) {
    case "critical": return "#ef4444";
    case "high": return "#f97316";
    case "info": return "#22c55e";
    default: return "#6b7280";
  }
}

export async function sendEventAlert(event: DetectedEvent, toEmail: string, studyName: string): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) {
    log("SMTP no configurado - alerta no enviada", "email");
    return false;
  }

  const eventLabel = EVENT_LABELS[event.eventType as keyof typeof EVENT_LABELS] || event.eventType;
  const severity = severityLabel(event.severity);
  const color = severityColor(event.severity);
  const dateStr = new Date(event.timestampStart).toLocaleString("es-ES", { timeZone: "UTC" });

  let mapsLink = "";
  let mapsHtml = "";
  if (event.lat && event.lng) {
    mapsLink = `https://www.google.com/maps?q=${event.lat},${event.lng}`;
    mapsHtml = `
      <tr>
        <td style="padding:8px;font-weight:bold;color:#374151">Ubicacion GPS</td>
        <td style="padding:8px">
          <a href="${mapsLink}" style="color:#3b82f6;text-decoration:underline" target="_blank">
            Ver en Google Maps (${event.lat.toFixed(6)}, ${event.lng.toFixed(6)})
          </a>
        </td>
      </tr>`;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:${color};color:white;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">${severity}: ${eventLabel}</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 8px 8px">
        <p style="margin:0 0 16px;color:#374151">Se ha detectado un evento en el estudio <strong>${studyName}</strong>:</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr style="background:#f9fafb">
            <td style="padding:8px;font-weight:bold;color:#374151">Tipo de evento</td>
            <td style="padding:8px">${eventLabel}</td>
          </tr>
          <tr>
            <td style="padding:8px;font-weight:bold;color:#374151">Animal</td>
            <td style="padding:8px">${event.individualLocalId}</td>
          </tr>
          <tr style="background:#f9fafb">
            <td style="padding:8px;font-weight:bold;color:#374151">Fecha</td>
            <td style="padding:8px">${dateStr}</td>
          </tr>
          ${mapsHtml}
          <tr style="background:#f9fafb">
            <td style="padding:8px;font-weight:bold;color:#374151">Descripcion</td>
            <td style="padding:8px">${event.description || "—"}</td>
          </tr>
        </table>
        <p style="margin:0;font-size:12px;color:#9ca3af">WildTrack — Sistema de Seguimiento de Fauna Silvestre</p>
      </div>
    </div>`;

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: toEmail,
      subject: `[WildTrack] ${severity}: ${eventLabel} — ${studyName}`,
      html,
    });
    log(`Email enviado a ${toEmail} para evento ${event.eventType}`, "email");
    return true;
  } catch (e: any) {
    log(`Error enviando email: ${e.message}`, "email");
    return false;
  }
}
