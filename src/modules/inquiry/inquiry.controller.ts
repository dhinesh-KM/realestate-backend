import { Request, Response } from 'express';
import { inquiryService } from './inquiry.service';
import { ApiResponse } from '../../shared/apiResponse';
import type { InquiryListQuery } from './inquiry.validation';
import type { InquiryPagination } from './inquiry.type';

export class InquiryController {

  // ── POST /inquiries ──────────────────────────────────────────
  /**
   * Send an inquiry to a property owner.
   * IP is extracted from req.ip (set by Express, respects X-Forwarded-For
   * when app.set('trust proxy', 1) is configured — critical when behind nginx).
   */
  async send(req: Request, res: Response) {
    const inquiry = await inquiryService.sendInquiry(
      req.user!.sub,
      req.body,
      {
        ip:        req.ip ?? '0.0.0.0',
        userAgent: req.headers['user-agent'],
      }
    );
    return ApiResponse.created(res, { inquiry }, 'Inquiry sent successfully');
  }

  // ── GET /inquiries/received ──────────────────────────────────
  /**
   * Owner's inbox — all inquiries received on their properties.
   * Supports cursor pagination + status filter.
   */
  async getReceived(req: Request, res: Response) {
    const q = req.query as unknown as InquiryListQuery;

    const pagination: InquiryPagination = {
      cursor: q.cursor,
      limit:  Number(q.limit ?? 20),
      status: q.status as any,
    };

    const { data, nextCursor, hasMore } = await inquiryService.getReceivedInquiries(
      req.user!.sub,
      pagination
    );

    return ApiResponse.paginated(res, data, { nextCursor, hasMore }, 'Inbox fetched');
  }

  // ── GET /inquiries/sent ──────────────────────────────────────
  /**
   * Sender's outbox — all inquiries they have submitted.
   */
  async getSent(req: Request, res: Response) {
    const q = req.query as unknown as InquiryListQuery;

    const pagination: InquiryPagination = {
      cursor: q.cursor,
      limit:  Number(q.limit ?? 20),
      status: q.status as any,
    };

    const { data, nextCursor, hasMore } = await inquiryService.getSentInquiries(
      req.user!.sub,
      pagination
    );

    return ApiResponse.paginated(res, data, { nextCursor, hasMore }, 'Sent inquiries fetched');
  }

  // ── GET /inquiries/:id ───────────────────────────────────────
  /**
   * Full inquiry detail. Auto-marks PENDING → READ when receiver views.
   * Access controlled — only sender or receiver may view.
   */
  async getById(req: Request, res: Response) {
    const inquiry = await inquiryService.getInquiryById(
      req.params.id,
      req.user!.sub
    );
    return ApiResponse.success(res, { inquiry });
  }

  // ── PATCH /inquiries/:id/status ──────────────────────────────
  /**
   * Owner updates inquiry status.
   * Valid transitions: PENDING→READ→RESPONDED→CLOSED, any→SPAM.
   * State machine enforced in service layer.
   */
  async updateStatus(req: Request, res: Response) {
    const inquiry = await inquiryService.updateStatus(
      req.params.id,
      req.user!.sub,
      req.body.status
    );
    return ApiResponse.success(res, { inquiry }, 'Inquiry status updated');
  }

  // ── DELETE /inquiries/:id ─────────────────────────────────────
  /**
   * Sender retracts their own inquiry.
   * Clears the 24-hour cooldown so they can re-inquire immediately.
   */
  async remove(req: Request, res: Response) {
    await inquiryService.deleteInquiry(req.params.id, req.user!.sub);
    return ApiResponse.success(res, null, 'Inquiry retracted successfully');
  }
}

export const inquiryController = new InquiryController();