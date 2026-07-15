import * as admin from 'firebase-admin';

export type TeamAnnouncementDeletionStatus = 'deleted' | 'alreadyDeleted';

export function getAnnouncementNotificationId(teamId: string, announcementId: string): string {
  return `coachAnnouncement_${teamId}_${announcementId}`;
}

export async function deleteTeamAnnouncementData(
  firestore: admin.firestore.Firestore,
  announcementRef: admin.firestore.DocumentReference,
  teamMemberUserIds: string[],
): Promise<{ notificationCount: number }> {
  // recursiveDelete removes the announcement document and every descendant,
  // including replies, reads, and any future announcement-only subcollection.
  await firestore.recursiveDelete(announcementRef);

  const memberUserIds = Array.from(new Set(teamMemberUserIds.filter(Boolean)));
  if (memberUserIds.length === 0) return { notificationCount: 0 };

  const notificationId = getAnnouncementNotificationId(
    announcementRef.parent.parent?.id ?? '',
    announcementRef.id,
  );
  const writer = firestore.bulkWriter();
  memberUserIds.forEach((userId) => {
    writer.delete(
      firestore
        .collection('userNotifications')
        .doc(userId)
        .collection('notifications')
        .doc(notificationId),
    );
  });
  await writer.close();
  return { notificationCount: memberUserIds.length };
}
