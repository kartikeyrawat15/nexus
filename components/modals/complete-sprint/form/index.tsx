import { type SprintView as Sprint } from "@/integration/legacy-views";
import { useForm } from "react-hook-form";
import { SprintDropdownField } from "./fields/sprint-dropdown";
import { type IssueType } from "@/utils/types";
import { useSprints } from "@/hooks/query-hooks/use-sprints";
import { FormSubmit } from "@/components/form/submit";

export type FormValues = {
  moveToSprintId: string;
};

const CompleteSprintForm: React.FC<{
  sprint: Sprint;
  issues: IssueType[];
  setModalIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({ sprint, setModalIsOpen }) => {
  const {
    handleSubmit,
    formState: { errors },
    control,
    reset,
  } = useForm<FormValues>({
    defaultValues: {
      moveToSprintId: "backlog",
    },
  });

  const { completeSprint, isCompleting } = useSprints();

  function handleCompleteSprint(data: FormValues) {
    completeSprint(
      {
        sprintId: sprint.id,
        expectedVersion: sprint.version,
        destinationSprintId: data.moveToSprintId === "backlog" ? null : data.moveToSprintId,
      },
      {
        onSuccess: () => {
          handleClose();
        },
      }
    );
  }

  function handleClose() {
    reset();
    setModalIsOpen(false);
  }

  return (
    <form
      // eslint-disable-next-line
      onSubmit={handleSubmit(handleCompleteSprint)}
      className="relative h-full"
    >
      <SprintDropdownField control={control} errors={errors} />
      <FormSubmit
        submitText="Complete"
        ariaLabel="Complete sprint"
        onCancel={handleClose}
        isLoading={isCompleting}
      />
    </form>
  );
};

export { CompleteSprintForm };
