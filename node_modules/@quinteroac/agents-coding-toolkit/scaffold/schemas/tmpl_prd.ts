import { z } from "zod";

const acceptanceCriterion = z.object({
    id: z.string(),
    text: z.string(),
});

const userStory = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    acceptanceCriteria: z.array(acceptanceCriterion),
});

const functionalRequirement = z.object({
    id: z.string(),
    description: z.string(),
});

export const PrdSchema = z.object({
    goals: z.array(z.string()),
    userStories: z.array(userStory),
    functionalRequirements: z.array(functionalRequirement),
});

export type Prd = z.infer<typeof PrdSchema>;
