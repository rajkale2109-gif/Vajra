import nodemailer from 'nodemailer';
import { config } from '../config/index.js';

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  sent: boolean;
  simulated: boolean;
  driver: 'log' | 'mailhog' | 'smtp';
  messageId?: string;
  error?: string;
}

export interface MailerService {
  sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;
  getSentLog(): SendEmailOptions[];
}

class LogMailer implements MailerService {
  private log: SendEmailOptions[] = [];

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    this.log.unshift(options);
    console.log(`[SIMULATED EMAIL LOG] To: ${options.to} | Subject: "${options.subject}"`);
    console.log(`[SIMULATED EMAIL BODY]:\n${options.text}\n---`);
    return {
      sent: false,
      simulated: true,
      driver: 'log',
      messageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    };
  }

  getSentLog(): SendEmailOptions[] {
    return [...this.log];
  }
}

class SmtpMailer implements MailerService {
  private transporter: nodemailer.Transporter;
  private log: SendEmailOptions[] = [];

  constructor(isMailhog = false) {
    this.transporter = nodemailer.createTransport({
      host: isMailhog ? config.SMTP_HOST : (config.SMTP_HOST || 'localhost'),
      port: isMailhog ? config.SMTP_PORT : (config.SMTP_PORT || 1025),
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: config.SMTP_FROM,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
      });

      this.log.unshift(options);
      return {
        sent: true,
        simulated: false,
        driver: config.MAILER_DRIVER as 'mailhog' | 'smtp',
        messageId: info.messageId,
      };
    } catch (err: any) {
      console.error('[SMTP ERROR]:', err);
      return {
        sent: false,
        simulated: false,
        driver: config.MAILER_DRIVER as 'mailhog' | 'smtp',
        error: err.message || 'SMTP transmission failure',
      };
    }
  }

  getSentLog(): SendEmailOptions[] {
    return [...this.log];
  }
}

export function createMailer(): MailerService {
  if (config.MAILER_DRIVER === 'smtp') {
    return new SmtpMailer(false);
  }
  if (config.MAILER_DRIVER === 'mailhog') {
    return new SmtpMailer(true);
  }
  return new LogMailer();
}

export const mailer = createMailer();
