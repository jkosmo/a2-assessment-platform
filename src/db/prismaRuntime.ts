import prismaClientModule from "@prisma/client";

const prismaClient = prismaClientModule as unknown as typeof import("@prisma/client");

const { PrismaClient, AppRole, AssessmentJobStatus, SubmissionStatus, DecisionType } = prismaClient;

export { PrismaClient, AppRole, AssessmentJobStatus, SubmissionStatus, DecisionType };
