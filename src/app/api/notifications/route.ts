import { NextRequest, NextResponse } from "next/server";

/**
 * HTTP endpoint for receiving notifications from the QuoteApprovalWorker
 * This replaces the socket.io real-time notifications with HTTP polling
 */
export async function POST(request: NextRequest) {
  try {
    // Verify the request is from our internal worker
    const authToken = request.headers.get("X-Worker-Auth");
    const expectedToken = process.env.WORKER_AUTH_TOKEN || "internal-worker";

    if (authToken !== expectedToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const notification = await request.json();

    // Log the notification for debugging
    console.log(
      `📨 [Notifications API] Received ${notification.type} notification:`,
      {
        entityId: notification.entityId,
        quoteId: notification.quoteId,
        offerId: notification.offerId,
        type: notification.type,
      },
    );

    // Store notification in a queue or database for client polling
    // In a serverless environment, you'd typically:
    // 1. Store in a database (Redis, PostgreSQL, etc.)
    // 2. Use a message queue (AWS SQS, Google Pub/Sub, etc.)
    // 3. Send push notifications (web push, mobile push)

    // For now, we'll just store in-memory (replace with proper storage)
    await storeNotification(notification);

    return NextResponse.json({
      success: true,
      message: "Notification received",
      notificationId: `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Notifications API] Error processing notification:", error);
    return NextResponse.json(
      { error: "Failed to process notification" },
      { status: 500 },
    );
  }
}

/**
 * GET endpoint for clients to poll for notifications
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const entityId = searchParams.get("entityId");
    const since = searchParams.get("since"); // ISO timestamp to get notifications after

    if (!entityId) {
      return NextResponse.json(
        { error: "entityId parameter is required" },
        { status: 400 },
      );
    }

    // Fetch notifications for this user
    const notifications = await getNotificationsForUser(entityId, since);

    return NextResponse.json({
      notifications,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Notifications API] Error fetching notifications:", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 },
    );
  }
}

// Temporary in-memory storage (replace with proper database/cache)
const notificationStore = new Map<string, any[]>();

async function storeNotification(notification: any) {
  const entityId = notification.entityId;
  if (!notificationStore.has(entityId)) {
    notificationStore.set(entityId, []);
  }

  const userNotifications = notificationStore.get(entityId)!;
  userNotifications.push({
    ...notification,
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    read: false,
  });

  // Keep only last 100 notifications per user
  if (userNotifications.length > 100) {
    userNotifications.shift();
  }
}

async function getNotificationsForUser(
  entityId: string,
  since?: string | null,
): Promise<any[]> {
  const userNotifications = notificationStore.get(entityId) || [];

  if (since) {
    const sinceDate = new Date(since);
    return userNotifications.filter((n) => new Date(n.timestamp) > sinceDate);
  }

  return userNotifications;
}

/**
 * DELETE endpoint to mark notifications as read or delete them
 */
export async function DELETE(request: NextRequest) {
  try {
    const { entityId, notificationId } = await request.json();

    if (!entityId || !notificationId) {
      return NextResponse.json(
        { error: "entityId and notificationId are required" },
        { status: 400 },
      );
    }

    const userNotifications = notificationStore.get(entityId);
    if (userNotifications) {
      const index = userNotifications.findIndex((n) => n.id === notificationId);
      if (index !== -1) {
        userNotifications.splice(index, 1);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Notification deleted",
    });
  } catch (error) {
    console.error("[Notifications API] Error deleting notification:", error);
    return NextResponse.json(
      { error: "Failed to delete notification" },
      { status: 500 },
    );
  }
}
