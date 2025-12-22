import { type NextRequest, NextResponse } from "next/server";
import { invalidateConsignmentCache } from "@/lib/cache";
import { validationErrorResponse } from "@/lib/validation/helpers";
import { ConsignmentService } from "@/services/consignmentService";
import { ConsignmentDB } from "@/services/database";
import {
  ConsignmentByIdResponseSchema,
  DeleteConsignmentQuerySchema,
  DeleteConsignmentResponseSchema,
  GetConsignmentByIdParamsSchema,
  GetConsignmentByIdQuerySchema,
  UpdateConsignmentRequestSchema,
  UpdateConsignmentResponseSchema,
} from "@/types/validation/api-schemas";
import { AddressSchema } from "@/types/validation/schemas";
import { isConsignmentOwner, sanitizeConsignmentForBuyer } from "@/utils/consignment-sanitizer";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;

  // Validate route params - return 400 on invalid params
  const paramsResult = GetConsignmentByIdParamsSchema.safeParse(routeParams);
  if (!paramsResult.success) {
    return validationErrorResponse(paramsResult.error, 400);
  }

  const { id } = paramsResult.data;

  const { searchParams } = new URL(request.url);

  // Validate query params - return 400 on invalid params
  const queryResult = GetConsignmentByIdQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!queryResult.success) {
    return validationErrorResponse(queryResult.error, 400);
  }
  const query = queryResult.data;

  // callerAddress can come from query param or header (check both)
  const queryCallerAddress =
    typeof query.callerAddress === "string" && query.callerAddress.trim() !== ""
      ? query.callerAddress
      : undefined;
  const headerCallerAddress = request.headers.get("x-caller-address");
  const callerAddress = queryCallerAddress || headerCallerAddress || undefined;

  // Consignment lookup - return 404 if not found
  let consignment;
  try {
    consignment = await ConsignmentDB.getConsignment(id);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return NextResponse.json(
        { success: false, error: `Consignment ${id} not found` },
        { status: 404 },
      );
    }
    throw err;
  }

  // Check if caller is the owner - only owner can see full negotiation terms
  const isOwner = isConsignmentOwner(consignment, callerAddress);

  // Sanitize response for non-owners to prevent gaming the negotiation
  const responseConsignment = isOwner ? consignment : sanitizeConsignmentForBuyer(consignment);

  const response = { success: true, consignment: responseConsignment };
  const validatedResponse = ConsignmentByIdResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params;

  // Validate route params - return 400 on invalid params
  const paramsResult = GetConsignmentByIdParamsSchema.safeParse(routeParams);
  if (!paramsResult.success) {
    return validationErrorResponse(paramsResult.error, 400);
  }

  const { id } = paramsResult.data;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate request body - return 400 on invalid params
  const bodyResult = UpdateConsignmentRequestSchema.safeParse(body);
  if (!bodyResult.success) {
    return validationErrorResponse(bodyResult.error, 400);
  }
  const data = bodyResult.data;

  const { callerAddress, ...updates } = data;

  // Consignment lookup - return 404 if not found
  let consignment;
  try {
    consignment = await ConsignmentDB.getConsignment(id);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return NextResponse.json(
        { success: false, error: `Consignment ${id} not found` },
        { status: 404 },
      );
    }
    throw err;
  }

  // Normalize addresses for comparison (Solana is case-sensitive, EVM is not)
  const normalizedCaller =
    consignment.chain === "solana" ? callerAddress : callerAddress.toLowerCase();
  const normalizedConsigner =
    consignment.chain === "solana"
      ? consignment.consignerAddress
      : consignment.consignerAddress.toLowerCase();

  if (normalizedCaller !== normalizedConsigner) {
    return NextResponse.json(
      { error: "Only the consigner can update this consignment" },
      { status: 403 },
    );
  }

  const service = new ConsignmentService();
  const updated = await service.updateConsignment(id, updates);

  // Invalidate cache so trading desk shows fresh data
  invalidateConsignmentCache();

  const response = { success: true, consignment: updated };
  const validatedResponse = UpdateConsignmentResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const routeParams = await params;

  // Validate route params - return 400 on invalid params
  const paramsResult = GetConsignmentByIdParamsSchema.safeParse(routeParams);
  if (!paramsResult.success) {
    return validationErrorResponse(paramsResult.error, 400);
  }

  const { id } = paramsResult.data;

  const { searchParams } = new URL(request.url);

  // Validate query params - return 400 on invalid params
  const queryResult = DeleteConsignmentQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!queryResult.success) {
    return validationErrorResponse(queryResult.error, 400);
  }
  const query = queryResult.data;

  // callerAddress can come from query param or header (check both)
  const queryCallerAddress =
    typeof query.callerAddress === "string" && query.callerAddress.trim() !== ""
      ? query.callerAddress
      : undefined;
  const headerCallerAddress = request.headers.get("x-caller-address");
  const callerAddress = queryCallerAddress || headerCallerAddress || undefined;

  if (!callerAddress) {
    return NextResponse.json(
      {
        error: "callerAddress query param or x-caller-address header is required",
      },
      { status: 400 },
    );
  }

  // Validate address format - return 400 if invalid
  const addressResult = AddressSchema.safeParse(callerAddress);
  if (!addressResult.success) {
    return validationErrorResponse(addressResult.error, 400);
  }

  // Consignment lookup - return 404 if not found
  let consignment;
  try {
    consignment = await ConsignmentDB.getConsignment(id);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return NextResponse.json(
        { success: false, error: `Consignment ${id} not found` },
        { status: 404 },
      );
    }
    throw err;
  }

  // Normalize addresses for comparison (Solana is case-sensitive, EVM is not)
  const normalizedCaller =
    consignment.chain === "solana" ? callerAddress : callerAddress.toLowerCase();
  const normalizedConsigner =
    consignment.chain === "solana"
      ? consignment.consignerAddress
      : consignment.consignerAddress.toLowerCase();

  if (normalizedCaller !== normalizedConsigner) {
    return NextResponse.json(
      { error: "Only the consigner can withdraw this consignment" },
      { status: 403 },
    );
  }

  const service = new ConsignmentService();
  await service.withdrawConsignment(id);

  // Invalidate cache so trading desk shows fresh data
  invalidateConsignmentCache();

  const response = { success: true };
  const validatedResponse = DeleteConsignmentResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}
