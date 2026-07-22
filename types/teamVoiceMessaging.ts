export type TeamVoiceMimeType = "audio/mp4" | "audio/m4a" | "audio/x-m4a";

export type VoiceMemoMetadata = {
  durationMilliseconds: number;
  sizeBytes: number;
  mimeType: TeamVoiceMimeType;
};

export type LocalVoiceMemoDraft = VoiceMemoMetadata & {
  uri: string;
  previewed: boolean;
};

export type StoredVoiceMemo = VoiceMemoMetadata & {
  storagePath: string;
};

export type TeamPrivateConversation = {
  conversationId: string;
  teamId: string;
  coachUserId: string;
  parentUserId: string;
  teamName: string;
  coachDisplayName: string;
  parentDisplayName: string;
  coachProfileState?: "available" | "unnamed" | "deleted";
  parentProfileState?: "available" | "unnamed" | "deleted";
  status: "active" | "readOnly";
  lastMessageAtMillis: number;
  lastMessageType: "text" | "voice" | null;
  lastMessagePreview: string | null;
  lastSenderUserId: string | null;
  unreadCount: number;
};

export type TeamPrivateMessage = {
  id: string;
  conversationId: string;
  teamId: string;
  senderUserId: string;
  senderRole: "coach" | "parent";
  contentType: "text" | "voice";
  text: string | null;
  caption: string | null;
  voiceMemo: StoredVoiceMemo | null;
  createdAt?: unknown;
};

export type VoiceUploadReservation = {
  reservationId: string;
  targetId: string;
  storagePath: string;
  expiresAtMillis: number;
};
