import {
  createContact,
  getContacts,
  getContactById,
  updateContact,
  archiveContact,
  deleteContact
} from "../services/contact.service.js";

import {
  createContactSchema,
  updateContactSchema,
  contactIdParamSchema,
  contactListQuerySchema
} from "../validators/contact.validators.js";

export async function createContactController(req, res) {
  const data = createContactSchema.parse(req.body);

  const contact = await createContact(
    data,
    req.user.id
  );

  return res.status(201).json({
    success: true,
    message: "Contact created successfully.",
    data: contact
  });
}

export async function getContactsController(req, res) {
  const query = contactListQuerySchema.parse(req.query);

  const result = await getContacts({
    ...query,
    ownerId: req.user.id
  });

  return res.status(200).json({
    success: true,
    message: "Contacts fetched successfully.",
    data: result.contacts,
    pagination: result.pagination
  });
}

export async function getContactController(req, res) {
  const { contactId } =
    contactIdParamSchema.parse(req.params);

  const contact = await getContactById(
    contactId,
    req.user.id
  );

  return res.status(200).json({
    success: true,
    message: "Contact fetched successfully.",
    data: contact
  });
}

export async function updateContactController(req, res) {
  const { contactId } =
    contactIdParamSchema.parse(req.params);

  const data = updateContactSchema.parse(req.body);

  const contact = await updateContact(
    contactId,
    req.user.id,
    data
  );

  return res.status(200).json({
    success: true,
    message: "Contact updated successfully.",
    data: contact
  });
}

export async function archiveContactController(req, res) {
  const { contactId } =
    contactIdParamSchema.parse(req.params);

  const contact = await archiveContact(
    contactId,
    req.user.id
  );

  return res.status(200).json({
    success: true,
    message: "Contact archived successfully.",
    data: contact
  });
}

export async function deleteContactController(req, res) {
  const { contactId } =
    contactIdParamSchema.parse(req.params);

  const result = await deleteContact(
    contactId,
    req.user.id
  );

  return res.status(200).json({
    success: true,
    message: "Contact deleted successfully.",
    data: result
  });
}