import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateReportDto, UpdateReportStatusDto } from './dto/report.dto.js';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private formatReport<
    T extends {
      id: string;
      target_slug: string;
      reason: string;
      reporter_phone: string;
      description: string;
      evidence_urls: string[];
      status: ReportStatus;
      created_at: Date;
      updated_at: Date;
    },
  >(report: T) {
    return {
      ...report,
      targetSlug: report.target_slug,
      reporterPhone: report.reporter_phone,
      evidenceUrls: report.evidence_urls,
      createdAt: report.created_at,
      updatedAt: report.updated_at,
    };
  }

  async createPublicReport(dto: CreateReportDto) {
    const targetSlug = (dto.target_slug ?? dto.targetSlug ?? '').trim().toLowerCase();
    if (!targetSlug) {
      throw new BadRequestException('Le slug de la boutique visée (target_slug) est obligatoire.');
    }

    const reporterPhone = (dto.reporter_phone ?? dto.reporterPhone ?? '').trim();
    if (!reporterPhone) {
      throw new BadRequestException(
        'Le numéro de téléphone du déclarant (reporter_phone) est obligatoire.',
      );
    }

    const reason = dto.reason.trim();
    const description = dto.description.trim();
    const evidenceUrls = (dto.evidence_urls ?? dto.evidenceUrls ?? []).map((u) =>
      u.trim(),
    );

    const created = await this.prisma.reports.create({
      data: {
        target_slug: targetSlug,
        reason,
        reporter_phone: reporterPhone,
        description,
        evidence_urls: evidenceUrls,
        status: ReportStatus.EN_ATTENTE,
      },
    });

    return this.formatReport(created);
  }

  async findAll(status?: ReportStatus) {
    const reports = await this.prisma.reports.findMany({
      where: status ? { status } : undefined,
      orderBy: { created_at: 'desc' },
    });

    return reports.map((r) => this.formatReport(r));
  }

  async updateStatus(id: string, dto: UpdateReportStatusDto) {
    const existing = await this.prisma.reports.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Signalement introuvable.');
    }

    const updated = await this.prisma.reports.update({
      where: { id },
      data: {
        status: dto.status,
      },
    });

    return this.formatReport(updated);
  }
}

