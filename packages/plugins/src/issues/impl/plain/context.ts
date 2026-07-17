import type { CustomerModel, EmailCustomerIdentityModel, ThreadModel } from '@team-plain/graphql';

const PRIORITY_LABELS = ['Urgent', 'High', 'Normal', 'Low'] as const;

export async function getPlainIssueDetails(
  thread: ThreadModel
): Promise<{ context: string | undefined }> {
  const customer = await readThreadCustomer(thread);
  return { context: formatPlainContext(thread, customer) };
}

async function readThreadCustomer(thread: ThreadModel): Promise<CustomerModel | undefined> {
  try {
    return await thread.customer;
  } catch {
    return undefined;
  }
}

function formatPlainContext(
  thread: ThreadModel,
  customer: CustomerModel | undefined
): string | undefined {
  const lines: string[] = [];
  const priority = priorityLabel(thread.priority);
  if (priority) lines.push(`Priority: ${priority}`);

  const customerLine = formatCustomer(customer);
  if (customerLine) lines.push(customerLine);

  const description = thread.description?.trim();
  const preview = thread.previewText?.trim();
  if (description && description !== preview) {
    lines.push('');
    lines.push(description);
  }

  return lines.length ? lines.join('\n') : undefined;
}

function priorityLabel(priority: number | null | undefined): string | undefined {
  if (priority == null) return undefined;
  return PRIORITY_LABELS[priority] ?? `P${priority}`;
}

function formatCustomer(customer: CustomerModel | undefined): string | undefined {
  if (!customer) return undefined;

  const fullName = customer.fullName?.trim();
  const email = customer.identities.find(isEmailCustomerIdentity)?.email;
  if (fullName && email) return `Customer: ${fullName} <${email}>`;
  if (fullName || email) return `Customer: ${fullName ?? email}`;
  return undefined;
}

function isEmailCustomerIdentity(
  identity: CustomerModel['identities'][number]
): identity is EmailCustomerIdentityModel {
  return identity.__typename === 'EmailCustomerIdentity';
}
