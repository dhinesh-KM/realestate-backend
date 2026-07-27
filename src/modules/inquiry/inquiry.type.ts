import type { InquiryStatus } from '../../shared/enums';

export { InquiryStatus };

// ── Input types ───────────────────────────────────────────────

export interface SendInquiryInput {
  propertyId: string;
  message: string;
}

export interface UpdateInquiryStatusInput {
  status: InquiryStatus;
}

// ── Response shapes ───────────────────────────────────────────

export interface InquiryParticipant {
  id:    string;
  name:  string;
  email: string;
  phone: string | null;
}

export interface InquiryPropertySnippet {
  id:          string;
  title:       string;
  city:        string;
  locality:    string;
  price:       string;
  primaryImage: string | null;
}

// Full inquiry detail — both sender and receiver can see this
export interface InquiryDto {
  id:         string;
  message:    string;
  status:     InquiryStatus;
  property:   InquiryPropertySnippet;
  sender:     InquiryParticipant;
  receiver:   InquiryParticipant;
  createdAt:  Date;
  updatedAt:  Date;
}

// Lean shape for inbox / sent-box lists
export interface InquiryListItem {
  id:          string;
  message:     string;       // truncated to 120 chars in list view
  status:      InquiryStatus;
  property:    InquiryPropertySnippet;
  counterpart: InquiryParticipant;  // the other person (sender/receiver depending on view)
  createdAt:   Date;
}

// ── Pagination ────────────────────────────────────────────────

export interface InquiryPagination {
  cursor?:    string;
  limit:      number;
  status?:    InquiryStatus;
}

// ── Spam detection result ─────────────────────────────────────

export interface SpamAnalysis {
  score:   number;    // 0–10
  reasons: string[];  // human-readable reasons for score
  block:   boolean;   // if true, reject the inquiry outright
}