"use client";
import {
  Modal,
  ModalContent,
  ModalOverlay,
  ModalPortal,
  ModalTitle,
} from "@/components/ui/modal";
import { type SprintView as Sprint } from "@/integration/legacy-views";
import { UpdateSprintForm } from "./form";

const UpdateSprintModal: React.FC<{
  sprint: Sprint;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({ sprint, isOpen, setIsOpen }) => {
  return (
    <Modal open={isOpen} onOpenChange={setIsOpen}>
      <ModalPortal>
        <ModalOverlay />
        <ModalContent>
          <ModalTitle>Edit Sprint: {sprint.name}</ModalTitle>
          <UpdateSprintForm sprint={sprint} setModalIsOpen={setIsOpen} />
        </ModalContent>
      </ModalPortal>
    </Modal>
  );
};

export { UpdateSprintModal };
