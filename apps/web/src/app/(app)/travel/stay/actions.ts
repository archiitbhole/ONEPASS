/**
 * Asking the concierge about a venue in the trip.
 *
 * A server action rather than another query parameter, for one reason: the trip
 * on screen was solved out of live rows, and re-running the whole solver because
 * somebody asked what time a restaurant opens would rewrite the plan underneath
 * them. The question goes on its own round trip and the answer comes back into
 * the component that asked it.
 *
 * `answerVenueQuestion` is the only thing that decides anything here. It
 * classifies the question by keyword, answers from rows, and returns
 * `confident: false` with the sources it does have when nothing supports an
 * answer. This action neither softens that nor fills the gap — it passes the
 * envelope straight back, and the component renders "I don't have that on file"
 * for an answer with nothing behind it.
 *
 * `userId` is taken from the session, never from the form. It is what scopes the
 * "my booking" intent, and a user id a client could set would be a client that
 * could read anybody's bookings.
 */
'use server';

import { answerVenueQuestion, type ConciergeIntent, type ConciergeSource } from '@/lib/assistant/concierge';
import { AppError } from '@/lib/errors';
import { currentActor } from '../../_queries';

export type ConciergeState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'answered';
      venueId: string;
      question: string;
      intent: ConciergeIntent;
      answer: string;
      confident: boolean;
      sources: ConciergeSource[];
    };

export async function askConciergeAction(
  _previous: ConciergeState,
  formData: FormData,
): Promise<ConciergeState> {
  const actor = await currentActor();

  const venueId = String(formData.get('venueId') ?? '').trim();
  const question = String(formData.get('question') ?? '').trim();

  if (!venueId) {
    return { status: 'error', message: 'Pick a venue from the trip first — the concierge only answers about one venue at a time.' };
  }
  if (question.length < 3) {
    return { status: 'error', message: 'Ask a question. It answers opening hours, facilities, directions, prices, live offers and your own bookings.' };
  }

  try {
    const result = await answerVenueQuestion({
      venueId,
      question: question.slice(0, 300),
      userId: actor.userId,
    });

    return {
      status: 'answered',
      venueId,
      question,
      intent: result.intent,
      answer: result.answer,
      confident: result.confident,
      sources: result.sources,
    };
  } catch (err) {
    if (err instanceof AppError) return { status: 'error', message: err.message };
    throw err;
  }
}
